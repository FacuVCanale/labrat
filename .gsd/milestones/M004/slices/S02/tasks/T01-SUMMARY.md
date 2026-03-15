---
id: T01
parent: S02
milestone: M004
provides:
  - "SyncResult type in types.ts"
  - "pushExperimentBranch() function in code-sync.ts"
  - "Contract test suite with 7 scenarios, 23 assertions"
key_files:
  - "src/resources/extensions/gsd/code-sync.ts"
  - "src/resources/extensions/gsd/tests/code-sync.test.ts"
  - "src/resources/extensions/gsd/types.ts"
key_decisions:
  - "Check remote ref before push to distinguish already-up-to-date (no push needed) from fresh push — avoids a redundant push + parse of 'Everything up-to-date' from git stderr"
  - "Post-push ls-remote verification ensures the remote actually has the commit, not just that push exited 0"
patterns_established:
  - "SyncResult struct pattern: { pushed, ref, remote, error? } — callers inspect fields, never catch exceptions for expected failures"
  - "setupRepoWithBareRemote() test helper: bare init + clone + initial push for realistic push/pull testing"
observability_surfaces:
  - "SyncResult.error contains git stderr on push failure — callers get actionable diagnostics without re-running"
  - "SyncResult.ref is the local HEAD hash at push time — audit trail for what was pushed"
duration: "15m"
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T01: Implement pushExperimentBranch and contract tests

**Standalone code-sync module with pushExperimentBranch() and 7-scenario contract test suite — all 23 assertions pass.**

## What Happened

Added `SyncResult` type to types.ts with `{ pushed, ref, remote, error? }` fields. Created `code-sync.ts` as a standalone module importing only `runGit` from `git-service.ts`. The function:

1. Gets current branch via `git branch --show-current` — empty string → detached HEAD error
2. Gets local HEAD hash
3. Checks remote ref via `ls-remote` before push — if already matching, returns `{ pushed: false }` without pushing
4. Pushes via normal `git push` (no force-push)
5. Verifies via `ls-remote` after push — confirms remote ref matches local HEAD

Contract tests use `setupRepoWithBareRemote()` (bare init + clone pattern) and cover: successful push, already-up-to-date, detached HEAD, bad remote name, diverged branch rejection, custom remote name, and no-remote-configured.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts` → Passed: 23, Failed: 0
- `npm run build` → my files produce zero type errors; pre-existing errors in `compute-backend.ts` (missing `RunEvalResult` type from S01) are unrelated
- `grep -c 'from.*auto\|from.*eval-runner\|from.*campaign' src/resources/extensions/gsd/code-sync.ts` → 0

Slice-level verification:
- ✅ Tests pass with all 6+ required scenarios
- ✅ Build passes for code-sync module (no new type errors)
- ⚠️ Pre-existing build failure in compute-backend.ts from S01 (RunEvalResult type missing) — not introduced by this task

## Diagnostics

`SyncResult` is the sole inspection surface. On failure, `.error` contains the git stderr message (e.g., "rejected" for diverged branches, "does not appear to be a git repository" for bad remotes). The `.ref` field records the local HEAD hash at push time. No persistent state — results are returned to callers.

## Deviations

None.

## Known Issues

Pre-existing build error in `compute-backend.ts` — imports `RunEvalResult` which doesn't exist in `types.ts`. This is from S01 and predates S02. Does not affect code-sync module.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `SyncResult` interface
- `src/resources/extensions/gsd/code-sync.ts` — new module with `pushExperimentBranch()`
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — contract tests (7 scenarios, 23 assertions)
- `.gsd/milestones/M004/slices/S02/S02-PLAN.md` — added Observability / Diagnostics section
- `.gsd/milestones/M004/slices/S02/tasks/T01-PLAN.md` — added Observability Impact section
