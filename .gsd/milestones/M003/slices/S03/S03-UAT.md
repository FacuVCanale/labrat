# S03: LLM-Assisted Conflict Adaptation — UAT

**Milestone:** M003
**Written:** 2026-03-14

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: The adaptation pipeline's mechanical correctness (prompt construction, output parsing, file application, verify/revert) is fully proven by 54 contract tests in synthetic git repos. LLM dispatch is fire-and-forget — the pipeline works regardless of LLM output quality. No live runtime or human judgment is needed to verify the pipeline works.

## Preconditions

- Repository builds clean: `npm run build` exits 0
- All 167 upstream-sync tests pass: `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 0 failed
- CLI is built: `node dist/cli.js sync --help` shows output

## Smoke Test

Run `node dist/cli.js sync --help` and confirm `--adapt` appears in the options list alongside `--apply <hash>`.

## Test Cases

### 1. Prompt construction from ConflictContext

1. In the test suite, locate the `S03: buildAdaptationPrompt` section
2. Verify test assertions confirm the prompt includes: upstream commit hash, subject line, per-file conflict details with merge markers, Labrat's current file version, upstream patch content, and output format specification with `// FILE: <path>` convention
3. Verify optional `labratSummary` parameter is included when provided and omitted when absent
4. **Expected:** All prompt construction assertions pass. The prompt contains structured sections that give an LLM complete context to resolve conflicts.

### 2. LLM output parsing — happy path

1. In the test suite, locate the `S03: parseAdaptedFiles` section
2. Verify tests cover: standard fenced code blocks with `// FILE: path` headers, multiple files in sequence, varied fence styles (```ts, ```typescript, plain ```)
3. **Expected:** `parseAdaptedFiles()` returns correct `AdaptedFile[]` with accurate `path` and `content` for each file.

### 3. LLM output parsing — edge cases

1. In the test suite, verify parsing handles: `## FILE: path` markdown-style headers, `**FILE: path**` bold-style headers, extra prose between code blocks, missing trailing fence (extends to end of input), completely unparseable input
2. **Expected:** Three header formats all parse correctly. Extra prose is ignored. Missing trailing fence captures remaining content. Unparseable input returns empty `AdaptedFile[]` (not a crash).

### 4. File application — success path

1. In the test suite, locate the `S03: applyAdaptedFiles` section
2. Verify test assertions for the success path: adapted files are written to disk, changes are staged and committed with `upstream-adapt(<short-hash>): <subject>` message format, `verifyAfterApply()` passes, sync state is updated with the applied commit hash
3. **Expected:** `ApplyResult.success` is true. Commit exists in git log. Sync state includes the hash in `appliedCommits`.

### 5. File application — verify failure triggers revert

1. In the test suite, verify the failure path: after adapted files are committed, if `verifyAfterApply()` fails (build or test failure), the commit is reverted and the repo is left clean
2. **Expected:** `ApplyResult.success` is false, `ApplyResult.error` describes the verify failure, the working tree is clean (no dangling adapted files), sync state is NOT updated.

### 6. File application — empty input rejection

1. Verify the test handles the case where `applyAdaptedFiles` is called with an empty `AdaptedFile[]` array
2. **Expected:** Returns `ApplyResult` with `success: false` and descriptive error. No git operations performed.

### 7. CLI --adapt flag parsing

1. Run `node dist/cli.js sync --help`
2. Verify `--adapt` appears with description mentioning conflict and stdout
3. **Expected:** Help text shows: `--adapt                   On conflict, print adaptation prompt to stdout (use with --apply)`

### 8. Prompt template loading

1. Run: `npx tsx -e "import { loadPrompt } from './src/resources/extensions/gsd/prompt-loader.ts'; const r = loadPrompt('adapt-upstream', {upstreamHash:'abc123', upstreamSubject:'fix bug', conflictDetails:'details here', outputFormat:'format spec'}); console.log('OK:', r.length, 'chars')"`
2. **Expected:** Prints "OK: <number> chars" without errors. All four placeholders (upstreamHash, upstreamSubject, conflictDetails, outputFormat) are substituted.

### 9. Prompt template with missing placeholder

1. Run: `npx tsx -e "import { loadPrompt } from './src/resources/extensions/gsd/prompt-loader.ts'; try { loadPrompt('adapt-upstream', {upstreamHash:'abc123'}); } catch(e) { console.log('Error caught:', e.message); }"`
2. **Expected:** Throws an error naming the missing placeholder variables (upstreamSubject, conflictDetails, outputFormat).

### 10. D055 decoupling invariant

1. Run: `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts`
2. **Expected:** Output is `0`. upstream-sync.ts has no imports from auto.ts or eval-runner.ts.

## Edge Cases

### Adapted commit message with special characters

1. In the test suite, verify that `applyAdaptedFiles` handles a `subject` string containing parentheses, quotes, or special shell characters
2. **Expected:** Commit message is correctly written via `-F -` stdin pipe (D059), not broken by shell escaping.

### Parse output with only prose, no code blocks

1. In the test suite, verify `parseAdaptedFiles("This is just a paragraph with no code blocks at all.")` returns empty array
2. **Expected:** Returns `[]` without crashing.

### Multiple adapted files for one conflict

1. In the test suite, verify `parseAdaptedFiles` correctly extracts multiple files when the LLM output contains 3+ fenced blocks with different `// FILE:` paths
2. **Expected:** Returns `AdaptedFile[]` with correct path and content for each file, in order.

## Failure Signals

- `npm run build` fails → type errors in new adaptation code or CLI flag wiring
- Upstream-sync test count drops below 167 → S03 assertions were accidentally removed or broken
- `node dist/cli.js sync --help` missing `--adapt` → CLI flag not wired or build stale
- `loadPrompt('adapt-upstream', ...)` throws → prompt template file missing or placeholder mismatch
- `grep` for auto/eval-runner imports returns > 0 → D055 decoupling violated

## Requirements Proved By This UAT

- R026 — GSD-2 Upstream Feature Sync: The full pipeline from fetch → categorize → report → apply → conflict detection → LLM adaptation prompt → parse → apply adapted files → verify → revert on failure is proven mechanically. The UAT confirms prompt construction assembles complete LLM context, output parsing handles real-world format variations, file application includes verify/revert safety, and all user surfaces (CLI --adapt, interactive dispatch, prompt template) are operational.

## Not Proven By This UAT

- Actual LLM output quality when adapting a real conflicting upstream commit — the pipeline is proven but the LLM's ability to produce correct adapted code depends on model capability and prompt effectiveness at runtime
- End-to-end `labrat sync --apply <hash> --adapt` against a real GSD-2 upstream commit with actual conflicts — this requires a live upstream remote and a conflicting commit

## Notes for Tester

- The 54 S03-specific contract tests use synthetic git repos (`mkdtempSync` + `git init`) — they prove mechanical correctness without requiring network access or a real upstream remote.
- Interactive dispatch (`pi.sendMessage` with `customType: "gsd-adapt"`) is wired but cannot be exercised without a running pi session — the dispatch path is verified by code inspection and build compilation.
- The `--adapt` CLI flag in report mode (without `--apply`) is a no-op — it only activates when a conflict is detected during `--apply`.
