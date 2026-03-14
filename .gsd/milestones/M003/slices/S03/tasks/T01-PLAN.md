---
estimated_steps: 5
estimated_files: 3
---

# T01: Implement adaptation core — prompt builder, output parser, file applicator + contract tests

**Slice:** S03 — LLM-Assisted Conflict Adaptation
**Milestone:** M003

## Description

Implement the three core adaptation functions in `upstream-sync.ts` — all testable without an LLM. `buildAdaptationPrompt()` is a pure function that assembles a complete prompt from `ConflictContext`. `parseAdaptedFiles()` extracts adapted file contents from LLM output (fenced code blocks). `applyAdaptedFiles()` writes the adapted files, commits, verifies, reverts on failure, and updates sync state. Add the `AdaptedFile` type to types.ts. Append ≥40 contract test assertions to the existing test file.

## Steps

1. Add `AdaptedFile` type (`{ path: string; content: string }`) to `types.ts` after the existing `ApplyResult` interface.

2. Implement `buildAdaptationPrompt(context: ConflictContext, labratSummary?: string): string` in `upstream-sync.ts`. Pure function — no I/O. Assembles sections: (a) upstream commit intent (hash, subject), (b) per-file conflict detail (merge markers, Labrat's version, upstream patch), (c) optional Labrat project summary, (d) output format specification (fenced code blocks with `// FILE: <path>` header line inside each block). Clear instructions to preserve both Labrat additions and upstream fix intent.

3. Implement `parseAdaptedFiles(llmOutput: string): AdaptedFile[]` in `upstream-sync.ts`. Scans for fenced code blocks (``` delimiters), looks for `// FILE: <path>` as the first non-empty line inside each block. Handles deviations: extra prose between blocks, varied fence styles (```ts, ```typescript), missing trailing fence (treat as extending to end), `## FILE:` or `**FILE:**` header variants. Returns empty array if no parseable blocks found.

4. Implement `applyAdaptedFiles(basePath: string, hash: string, subject: string, adaptedFiles: AdaptedFile[]): ApplyResult` in `upstream-sync.ts`. Flow: validate adaptedFiles non-empty → write each file to disk → `git add` each file → `git commit -F -` with `upstream-adapt(<short-hash>): <subject>` message → `verifyAfterApply()` → if verify fails: revert commit and return error → if verify passes: update sync state via `readSyncState`/`writeSyncState` → return success. Every exit path must leave repo clean. Uses existing `runGit()` for all git operations.

5. Add S03 test section to `upstream-sync.test.ts` after the S02 block. Test scenarios: prompt construction (contains hash, subject, merge markers, format instructions; handles multiple files; includes optional summary; omits summary when not provided), parsing (single file block, multiple files, extra prose between blocks, missing trailing fence, no FILE header skips block, varied header formats, completely unparseable returns empty), file application (writes files + commits + passes verify → success + state updated; verify failure → reverted to pre-apply state; empty adaptedFiles → error; write failure path). ≥40 new assertions.

## Must-Haves

- [ ] `AdaptedFile` type exported from types.ts
- [ ] `buildAdaptationPrompt` is pure — no I/O, no imports from auto.ts/eval-runner.ts
- [ ] `parseAdaptedFiles` handles: happy path, multiple files, extra prose, missing fence, no-header skip, empty/unparseable input
- [ ] `applyAdaptedFiles` commits with `upstream-adapt(...)` message pattern, reverts on verify failure, updates state on success
- [ ] Every exit path in `applyAdaptedFiles` leaves repo clean (no staged changes, no partial commits)
- [ ] ≥40 new S03 assertions pass, 0 fail

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → all S01+S02+S03 assertions pass, total ≥153, 0 failed
- `npm run build` → compiles clean
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts` → 0

## Observability Impact

- Signals added/changed: `ApplyResult` returned by `applyAdaptedFiles` — same structure as `applyUpstreamCommit`, distinguishable by `upstream-adapt(...)` commit message pattern
- How a future agent inspects this: `readSyncState(basePath).appliedCommits` includes adapted hashes; `git log --grep="upstream-adapt"` shows adapted commits
- Failure state exposed: `ApplyResult.error` describes failure reason (empty input, write failure, verify failure); `ApplyResult.verifyResult` has build/test output

## Inputs

- `src/resources/extensions/gsd/types.ts` — existing `ConflictContext`, `ConflictFileInfo`, `ApplyResult`, `VerifyResult` types
- `src/resources/extensions/gsd/upstream-sync.ts` — existing `verifyAfterApply()`, `readSyncState()`, `writeSyncState()`, `runGit()` functions
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — existing test infrastructure (`setupRepoWithUpstream()`, `assert`/`assertEq` helpers, `passed`/`failed` counters)
- S02 forward intelligence: `ConflictContext.conflictingFiles[].withMarkers` contains `<<<<<<<` markers, `.labratVersion` is HEAD content, `.upstreamPatch` is diff

## Expected Output

- `src/resources/extensions/gsd/types.ts` — `AdaptedFile` type added
- `src/resources/extensions/gsd/upstream-sync.ts` — three new exported functions: `buildAdaptationPrompt`, `parseAdaptedFiles`, `applyAdaptedFiles`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — S03 test section with ≥40 new assertions
