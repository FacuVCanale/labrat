# S03: LLM-Assisted Conflict Adaptation

**Goal:** When `labrat sync --apply <commit>` encounters a conflict, the pipeline can dispatch the conflict context to an LLM which produces adapted file contents, applies them, verifies the build+tests pass, and reverts on failure.
**Demo:** Contract tests prove prompt construction, LLM output parsing (including edge cases), and adapted file application with commit/verify/revert — all without an LLM. The `--adapt` flag is wired in CLI and interactive paths.

## Must-Haves

- `buildAdaptationPrompt()` pure function assembles complete prompt from `ConflictContext` with all required sections (upstream intent, per-file conflict details, output format instructions)
- `parseAdaptedFiles()` extracts `AdaptedFile[]` from fenced code blocks with file path headers, handles format deviations (extra text, missing fences, varied header formats)
- `applyAdaptedFiles()` writes adapted files, commits with `upstream-adapt(<short-hash>): <subject>` message, runs `verifyAfterApply()`, reverts on failure, updates sync state on success
- Every exit path in `applyAdaptedFiles()` leaves the repo clean
- `adapt-upstream.md` prompt template with `{{variable}}` placeholders loaded via `loadPrompt()`
- `--adapt` CLI flag on `labrat sync --apply <hash> --adapt`
- Interactive `/gsd sync --apply <hash> --adapt` dispatches adaptation workflow via `dispatchWorkflow()`
- D055 maintained: no imports from auto.ts, eval-runner.ts, or campaign lifecycle in upstream-sync.ts

## Proof Level

- This slice proves: contract + integration (synthetic git repos for mechanics, real prompt template loading for wiring)
- Real runtime required: no (LLM dispatch is fire-and-forget; proving the prompt is built and the pipeline works mechanically is the contract)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → all S01+S02+S03 assertions pass, 0 failed
- S03-specific assertions cover: prompt construction (content sections), parsing (happy path, edge cases, malformed input), file application (success, verify failure revert, write failure), state update after adapted apply
- `npm run build` → compiles clean
- `node dist/cli.js sync --help` → shows `--adapt` in options
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts` → 0 (D055)

## Observability / Diagnostics

- Runtime signals: `ApplyResult` returned by `applyAdaptedFiles` includes `success`, `error`, `verifyResult` — same structure as `applyUpstreamCommit`
- Inspection surfaces: `readSyncState(basePath).appliedCommits` tracks adapted commits alongside clean cherry-picks; CLI `--adapt` outputs structured result to stdout/stderr
- Failure visibility: parse failures return empty `AdaptedFile[]` with diagnostic; `applyAdaptedFiles` surfaces verify failure details in `ApplyResult.error`

## Integration Closure

- Upstream surfaces consumed: `ConflictContext`/`ConflictFileInfo` from S02, `verifyAfterApply()` from S02, `readSyncState()`/`writeSyncState()` from S01, `loadPrompt()` from prompt-loader.ts, `dispatchWorkflow()` pattern from guided-flow.ts
- New wiring introduced in this slice: `--adapt` flag in CLI, interactive adaptation dispatch in commands.ts, `adapt-upstream.md` prompt template
- What remains before the milestone is truly usable end-to-end: nothing — S03 completes M003

## Tasks

- [x] **T01: Implement adaptation core — prompt builder, output parser, file applicator + contract tests** `est:35m`
  - Why: The three pure/git-ops functions are the mechanical foundation — without them the wiring has nothing to connect. Testing them independently from LLM proves the pipeline works.
  - Files: `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/upstream-sync.ts`, `src/resources/extensions/gsd/tests/upstream-sync.test.ts`
  - Do: Add `AdaptedFile` type to types.ts. Implement `buildAdaptationPrompt(context: ConflictContext, labratSummary?: string): string` as pure function — includes upstream intent, per-file sections (merge markers, Labrat version, upstream patch), output format spec (fenced code blocks with `// FILE: path` headers). Implement `parseAdaptedFiles(llmOutput: string): AdaptedFile[]` — extracts fenced blocks with file path detection, handles common deviations (extra prose, varied header formats, missing trailing fence). Implement `applyAdaptedFiles(basePath: string, hash: string, subject: string, adaptedFiles: AdaptedFile[]): ApplyResult` — writes files, stages, commits via `-F -` stdin with `upstream-adapt(<short-hash>): <subject>`, runs `verifyAfterApply()`, reverts on failure, updates sync state on success. Add S03 contract test section with ≥40 assertions covering all three functions.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → all pass, 0 failed; `npm run build` → clean
  - Done when: All three functions exported, ≥40 new S03 assertions pass, D055 import check passes

- [x] **T02: Wire prompt template, CLI --adapt flag, and interactive dispatch** `est:20m`
  - Why: Connects the mechanical pipeline to user-facing surfaces — CLI prints the adaptation prompt on conflict, interactive mode dispatches to LLM.
  - Files: `src/resources/extensions/gsd/prompts/adapt-upstream.md`, `src/cli.ts`, `src/resources/extensions/gsd/commands.ts`
  - Do: Create `adapt-upstream.md` template with `{{upstreamHash}}`, `{{upstreamSubject}}`, `{{conflictDetails}}`, `{{outputFormat}}` placeholders — instructs LLM to produce adapted file contents preserving both Labrat additions and upstream fix. Add `adapt` boolean to CliFlags, `--adapt` flag parsing in parseCliArgs, help text update. In CLI apply handler: when `result.conflicted && cliFlags.adapt`, call `buildAdaptationPrompt()` with conflict context, print prompt to stdout for piping/manual use. In interactive `handleSync`: parse `--adapt` from rawCommand, when conflict detected with `--adapt`, load `adapt-upstream.md` via `loadPrompt()`, dispatch via `dispatchWorkflow()` pattern from guided-flow.ts. Update interactive help/completion for `--adapt`.
  - Verify: `npm run build` → clean; `node dist/cli.js sync --help` → shows `--adapt`; prompt template loads without error via `loadPrompt('adapt-upstream', {...})`
  - Done when: CLI `--adapt` flag operational, interactive dispatch wired, prompt template loadable with all placeholders satisfied

## Files Likely Touched

- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/upstream-sync.ts`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts`
- `src/resources/extensions/gsd/prompts/adapt-upstream.md`
- `src/cli.ts`
- `src/resources/extensions/gsd/commands.ts`
