---
id: T02
parent: S02
milestone: M001
provides:
  - commitExperiment() and revertExperiment() methods on GitServiceImpl
  - Public wrapper functions in worktree.ts for experiment git operations
  - run-experiment added to dispatch guard SLICE_DISPATCH_TYPES
  - Integration tests for experiment commit/revert lifecycle and dispatch guard
key_files:
  - src/resources/extensions/gsd/git-service.ts
  - src/resources/extensions/gsd/worktree.ts
  - src/resources/extensions/gsd/dispatch-guard.ts
  - src/resources/extensions/gsd/tests/git-experiment.test.ts
key_decisions:
  - commitExperiment uses smartStage() then throws on empty staging (no silent no-ops for commits — caller must know)
  - revertExperiment uses git revert --no-commit + manual commit for custom message format; idempotent via empty staging check
  - run-experiment added to SLICE_DISPATCH_TYPES set (same sequential check as other slice work — experiments can't dispatch until prior slices complete on main)
patterns_established:
  - experiment(E001) / revert(E001) commit message convention for git log discoverability
  - Idempotent revert pattern — check staged diff after revert, skip commit if empty
observability_surfaces:
  - Experiment commits discoverable via `git log --oneline --grep="experiment("` on campaign branch
  - Revert commits discoverable via `git log --oneline --grep="revert("` on campaign branch
  - commitExperiment returns commit hash — callers can verify with git rev-parse
  - revertExperiment idempotent — repeated calls are silent no-ops
  - Dispatch guard: getPriorSliceCompletionBlocker() now returns blocker/null for run-experiment dispatches
duration: 15m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Add git experiment operations and dispatch guard adaptation

**Added `commitExperiment()` and `revertExperiment()` to GitServiceImpl with atomic commit/revert lifecycle, adapted dispatch guard for `run-experiment`, and exported public wrappers from worktree.ts.**

## What Happened

Added two methods to `GitServiceImpl`:
- `commitExperiment(experimentId, description)` — stages via `smartStage()`, commits with `experiment(E001): description` message format, returns commit hash. Throws if nothing to commit.
- `revertExperiment(experimentId, commitHash, reason)` — uses `git revert --no-commit` then commits with `revert(E001): discard — reason` format. Idempotent: if the commit was already reverted (empty staging after revert), silently returns.

Added `"run-experiment"` to `SLICE_DISPATCH_TYPES` in `dispatch-guard.ts` so experiments get the same sequential slice ordering check as other dispatch types.

Added `commitExperiment()` and `revertExperiment()` wrapper functions to `worktree.ts`, delegating to `getService(basePath)` following the existing pattern.

Wrote 14 integration tests covering: commit message format, hash return, empty commit error, revert message format, clean working tree after revert, idempotent revert (no duplicate commit), tree hash match pre/post experiment, and dispatch guard allowing/blocking `run-experiment`.

## Verification

- `npm run build` — exits 0 with no errors
- `git-experiment.test.ts` — 14/14 tests pass
- `git-service.test.ts` — existing tests still pass
- `dispatch-guard.test.ts` — existing tests still pass

### Slice-level verification status (T02 of 2 — final task)
- ✅ `npm run build` passes with new Phase value handled everywhere
- ✅ `research-types.test.ts` — all test cases pass
- ✅ `git-experiment.test.ts` — all test cases pass (commit/revert lifecycle, dispatch guard)
- ✅ Failure-path diagnostic: malformed CAMPAIGN.json returns normal phase (verified in T01)
- ✅ Dispatch guard allows/blocks `run-experiment` based on prior slice completion

## Diagnostics

- Experiment commits discoverable: `git log --oneline --grep="experiment("` on campaign branch
- Revert commits discoverable: `git log --oneline --grep="revert("` on campaign branch
- `commitExperiment()` returns commit hash for revert reference — verify with `git rev-parse {hash}`
- `revertExperiment()` is idempotent — calling twice on same hash is safe
- `getPriorSliceCompletionBlocker(base, main, "run-experiment", "M001/S02")` returns null when allowed, string when blocked

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/git-service.ts` — Added commitExperiment() and revertExperiment() methods to GitServiceImpl
- `src/resources/extensions/gsd/dispatch-guard.ts` — Added "run-experiment" to SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/worktree.ts` — Added commitExperiment() and revertExperiment() public wrapper functions
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — 14 integration tests for experiment git operations and dispatch guard
- `.gsd/milestones/M001/slices/S02/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
