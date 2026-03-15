---
id: S02
parent: M004
milestone: M004
provides:
  - "SyncResult type in types.ts"
  - "pushExperimentBranch(basePath, remote?) function in code-sync.ts"
  - "Contract test suite with 7 scenarios, 23 assertions"
requires:
  - slice: S01
    provides: "ComputeBackend interface (to know when sync is needed — remote backends only)"
affects:
  - S03
  - S04
key_files:
  - "src/resources/extensions/gsd/code-sync.ts"
  - "src/resources/extensions/gsd/tests/code-sync.test.ts"
  - "src/resources/extensions/gsd/types.ts"
key_decisions:
  - "Pre-push ls-remote check to distinguish already-up-to-date from needing push — avoids redundant push + parsing 'Everything up-to-date' from git stderr (D068)"
  - "Post-push ls-remote verification ensures remote actually has the commit, not just that push exited 0 (D069)"
patterns_established:
  - "SyncResult struct pattern: { pushed, ref, remote, error? } — callers inspect fields, never catch exceptions for expected failures"
  - "setupRepoWithBareRemote() test helper: bare init + clone + initial push for realistic push/pull testing"
observability_surfaces:
  - "SyncResult.error contains git stderr on push failure — callers get actionable diagnostics without re-running"
  - "SyncResult.ref is the local HEAD hash at push time — audit trail for what was pushed"
drill_down_paths:
  - ".gsd/milestones/M004/slices/S02/tasks/T01-SUMMARY.md"
duration: "15m"
verification_result: passed
completed_at: 2026-03-15
---

# S02: Git Code Sync

**Standalone `pushExperimentBranch()` module pushes experiment branches to git remotes with structured error handling and post-push verification — 7 scenarios, 23 assertions passing.**

## What Happened

Added `SyncResult` type to `types.ts` with `{ pushed, ref, remote, error? }` fields. Created `code-sync.ts` as a standalone module importing only `runGit` from `git-service.ts`. The function follows a six-step flow: get current branch (detached HEAD → error), get local HEAD hash, check remote ref via `ls-remote` (already matching → no-op), push, verify via `ls-remote` that remote matches local HEAD. All failure modes return structured `SyncResult` with error field — never throws.

Contract tests use `setupRepoWithBareRemote()` helper (bare init + clone pattern) covering: successful push of new commits, already-up-to-date no-op, detached HEAD, bad remote name, diverged branch rejection, custom remote name, and no-remote-configured.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts` → Passed: 23, Failed: 0
- `npm run build` → code-sync module clean; pre-existing errors in `compute-backend.ts` (missing `RunEvalResult` from S01) unrelated
- Zero imports from auto.ts, eval-runner.ts, or campaign modules — fully decoupled

## Requirements Advanced

- R032 (Code Sync via Git) — `pushExperimentBranch()` implements the core push-and-verify flow

## Requirements Validated

- R032 (Code Sync via Git) — Contract tests prove: push succeeds for new commits, no-op when up-to-date, detached HEAD detected, missing remote reported, diverged branch produces error, custom remote supported. All structured via SyncResult, never thrown.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Pre-existing build error in `compute-backend.ts` imports `RunEvalResult` which doesn't exist in `types.ts` — from S01, predates S02. Does not affect code-sync module.
- `pushExperimentBranch` uses normal `git push` only (D063) — force-push scenarios not handled by design.

## Follow-ups

- none

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `SyncResult` interface
- `src/resources/extensions/gsd/code-sync.ts` — new module with `pushExperimentBranch()`
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — contract tests (7 scenarios, 23 assertions)

## Forward Intelligence

### What the next slice should know
- `pushExperimentBranch(basePath, remote?)` returns `SyncResult` — check `.error` for failures, `.pushed` for whether a push actually happened. Import from `./code-sync.ts`.
- The function uses `runGit` (which throws on non-zero exit). All throws are caught and converted to `SyncResult.error` — callers never need try/catch.
- Remote defaults to `"origin"` matching GitPreferences.remote pattern.

### What's fragile
- The `ls-remote` output parsing splits on whitespace to extract the hash — if git changes ls-remote format, verification breaks silently (would report push success but with verification error in `.error` field).

### Authoritative diagnostics
- `SyncResult.error` — the git stderr message on any failure. This is the first place to look when push fails.
- `SyncResult.ref` — the local HEAD hash at push time. Compare against remote to verify sync.

### What assumptions changed
- None — implementation matched plan exactly.
