---
id: T01
parent: S03
milestone: M003
provides:
  - buildAdaptationPrompt() pure function for conflict-to-prompt assembly
  - parseAdaptedFiles() LLM output parser with edge-case handling
  - applyAdaptedFiles() file writer + commit + verify + revert pipeline
  - AdaptedFile type exported from types.ts
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/upstream-sync.ts
  - src/resources/extensions/gsd/tests/upstream-sync.test.ts
key_decisions:
  - Parse FILE headers support three variants (// FILE:, ## FILE:, **FILE:**) for robustness against LLM format drift
  - applyAdaptedFiles uses same revert pattern as applyUpstreamCommit (revert --no-commit + commit, fallback to reset --hard HEAD~1)
  - Commit message format upstream-adapt(<short-hash>) distinguishes adapted commits from clean cherry-picks in git log
patterns_established:
  - extractFilePath private helper for multi-format header detection
  - Adaptation pipeline mirrors cherry-pick pipeline (validate → write → commit → verify → revert/succeed)
observability_surfaces:
  - ApplyResult returned by applyAdaptedFiles — same structure as applyUpstreamCommit
  - readSyncState(basePath).appliedCommits includes adapted commit hashes
  - git log --grep="upstream-adapt" shows adapted commits
duration: 15m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Implement adaptation core — prompt builder, output parser, file applicator + contract tests

**Added three core adaptation functions (buildAdaptationPrompt, parseAdaptedFiles, applyAdaptedFiles) with AdaptedFile type and 54 contract test assertions — all passing.**

## What Happened

Added `AdaptedFile` type (`{ path: string; content: string }`) to types.ts after `ApplyResult`.

Implemented `buildAdaptationPrompt(context, labratSummary?)` as a pure function assembling four sections: upstream commit intent (hash + subject), per-file conflict details (merge markers, Labrat version, upstream patch in fenced blocks), optional project summary, and output format specification with `// FILE: <path>` header convention.

Implemented `parseAdaptedFiles(llmOutput)` to extract adapted files from fenced code blocks. Handles: varied fence styles (```ts, ```typescript), extra prose between blocks, missing trailing fence (extends to end), `## FILE:` and `**FILE:**` header variants. Returns empty array for unparseable input.

Implemented `applyAdaptedFiles(basePath, hash, subject, adaptedFiles)` with the flow: validate non-empty → write files → git add → commit with `upstream-adapt(<short-hash>): <subject>` → verifyAfterApply → revert on failure / update state on success. Every exit path leaves repo clean.

Added 54 new S03 assertions (total test suite: 167 passed, 0 failed).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 167 passed, 0 failed (113 S01+S02 + 54 S03)
- `npm run build` → compiles clean
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts` → 0 (D055 maintained)
- Slice verification: tests pass ✅, build clean ✅, D055 check ✅
- Slice verification pending T02: `node dist/cli.js sync --help` → `--adapt` flag (not yet wired)

## Diagnostics

- `readSyncState(basePath).appliedCommits` includes hashes applied via adaptation
- `git log --grep="upstream-adapt"` shows commits made by `applyAdaptedFiles`
- `ApplyResult.error` describes failure reason (empty input, write failure, verify failure)
- `ApplyResult.verifyResult` has build/test output on verify failure

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — Added `AdaptedFile` interface after `ApplyResult`
- `src/resources/extensions/gsd/upstream-sync.ts` — Added `buildAdaptationPrompt`, `parseAdaptedFiles`, `applyAdaptedFiles` exports + `extractFilePath` private helper; updated type imports/re-exports
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — Added S03 test section with 54 assertions covering prompt construction, parsing edge cases, and file application
