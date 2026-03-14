---
id: T01
parent: S02
milestone: M003
provides:
  - applyUpstreamCommit() — cherry-pick with conflict detection, verify, revert-on-failure
  - verifyAfterApply() — build+test verification with timeouts and structured results
  - getConflictContext() — merge marker extraction, Labrat version, upstream patch per file
  - ApplyResult, VerifyResult, ConflictContext types exported from types.ts
key_files:
  - src/resources/extensions/gsd/upstream-sync.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/upstream-sync.test.ts
key_decisions:
  - D059 — git commit messages via stdin (-F -) to avoid shell escaping issues with parentheses
patterns_established:
  - Cherry-pick flow: --no-commit → commit via -F - → verify → revert-on-failure → state update
  - Conflict context extraction before abort (merge markers only exist while conflict is active)
  - Every exit path in applyUpstreamCommit either aborts cherry-pick or resets to clean state
observability_surfaces:
  - readSyncState(basePath).appliedCommits — list of successfully applied hashes
  - ApplyResult.conflictContext.conflictingFiles[].withMarkers — per-file conflict markers
  - ApplyResult.error — structured error message on any failure path
  - ApplyResult.verifyResult — build/test pass status with output
duration: 25m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Implement apply, verify, and conflict-context functions with contract tests

**Implemented `applyUpstreamCommit`, `verifyAfterApply`, and `getConflictContext` with 5 new types and 50 contract test assertions covering clean/conflict/error/already-applied/dirty-tree paths.**

## What Happened

Added `ApplyResult`, `VerifyResult`, `ConflictContext`, `ConflictFileInfo` types to types.ts. Implemented three functions in upstream-sync.ts:

1. **`verifyAfterApply(basePath)`** — runs `npm run build` (120s timeout) then `npm test` (300s timeout) with 10MB maxBuffer. Missing package.json or scripts treated as pass with skip note. Output truncated at 8K chars.

2. **`getConflictContext(basePath, hash)`** — reads unmerged files via `git diff --name-only --diff-filter=U`, extracts merge markers from working tree, Labrat's pre-cherry-pick version via `git show HEAD:<file>`, and upstream patch via `git diff <hash>~1 <hash> -- <file>`.

3. **`applyUpstreamCommit(basePath, hash)`** — validates not already applied, checks clean working tree, runs `git cherry-pick --no-commit <hash>`. Clean path: commit → verify → revert on failure → update state. Conflict path: extract context BEFORE abort → return structured conflict. Wrapped in try/catch, never throws.

Also fixed pre-existing `require('node:fs')` call in `writeSyncState` that fails under ESM/tsx — replaced with static import of `mkdirSync`.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → **113 passed, 0 failed** (63 S01 + 50 S02)
- `npm run build` → compiles clean
- S02 test scenarios: clean cherry-pick, conflict with context extraction, already-applied rejection, verify with no package.json, verify with no scripts, state persistence on disk, getConflictContext structure validation, dirty working tree guard
- Failure-path verification: `ApplyResult.error` populated on all failure paths, `conflictContext.conflictingFiles[].withMarkers` contains `<<<<<<<` markers on conflict path

### Slice-level verification (partial — T01 of 2):
- ✅ Tests pass with all S01 + S02 assertions
- ✅ Build compiles clean
- ⏳ `node dist/cli.js sync --help` shows `--apply <hash>` — T02 scope
- ✅ Contract tests verify inspectable failure state

## Diagnostics

- `readSyncState(basePath).appliedCommits` — see what's been applied
- `ApplyResult.conflictContext` — structured conflict data (hash, subject, per-file withMarkers/labratVersion/upstreamPatch)
- `ApplyResult.error` — human-readable error for any failure
- `ApplyResult.verifyResult.buildOutput` / `.testOutput` — captured verify output
- `cat .gsd/UPSTREAM-SYNC.json` — raw state file on disk

## Deviations

- Fixed pre-existing `require('node:fs')` ESM incompatibility in `writeSyncState` — was using dynamic `require` instead of the already-available static import. This is a bugfix not a plan deviation.
- Used `git commit -F -` with stdin pipe instead of `-m` flag (D059) — discovered during testing that parentheses in commit messages break shell parsing.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `ApplyResult`, `VerifyResult`, `ConflictContext`, `ConflictFileInfo` types
- `src/resources/extensions/gsd/upstream-sync.ts` — added `applyUpstreamCommit`, `verifyAfterApply`, `getConflictContext` exports; added `execSync` and `mkdirSync` imports; fixed `require()` ESM bug in `writeSyncState`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — added 7 S02 test scenarios with 50 new assertions
- `.gsd/milestones/M003/slices/S02/S02-PLAN.md` — added failure-path verification step
- `.gsd/DECISIONS.md` — added D059
