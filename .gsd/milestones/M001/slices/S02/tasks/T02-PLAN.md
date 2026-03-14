---
estimated_steps: 5
estimated_files: 5
---

# T02: Add git experiment operations and dispatch guard adaptation

**Slice:** S02 — Research Types & State Machine
**Milestone:** M001

## Description

Add `commitExperiment()` and `revertExperiment()` methods to `GitServiceImpl` for atomic experiment lifecycle on campaign branches. Adapt the dispatch guard to permit `run-experiment` dispatches. Verify the full contract: campaign config → experimenting phase → experiment commit → revert → clean state.

## Steps

1. **Add `commitExperiment()` to `GitServiceImpl`** — Takes `experimentId` (e.g., "E001") and `description` (short text of what was tried). Stages all changes to target files, commits with message `experiment(E001): {description}`. Uses existing `smartStage()` pattern. Returns the commit hash for later revert reference.

2. **Add `revertExperiment()` to `GitServiceImpl`** — Takes `experimentId` and the commit hash from `commitExperiment()`. Creates a revert commit with message `revert(E001): discard — {reason}`. Uses `git revert --no-edit {hash}` for clean revert history. Must handle the case where the commit has already been reverted (idempotent).

3. **Adapt dispatch guard in `dispatch-guard.ts`** — Add `"run-experiment"` to `SLICE_DISPATCH_TYPES` set so that experiments get the same sequential slice check, OR bypass the guard entirely for experiment dispatches since experiments within a single slice don't need cross-slice ordering. The simpler approach: add it to the set so the existing guard logic applies naturally (experiments in S02 can't dispatch until S01 is done on main).

4. **Add wrapper functions to `worktree.ts`** — Export `commitExperiment()` and `revertExperiment()` wrappers that delegate to `getService(basePath)`, matching the existing pattern (e.g., `autoCommitCurrentBranch()`). These are the public API that S03's eval runner will call.

5. **Write integration tests in `tests/git-experiment.test.ts`** — Set up a temp git repo with a campaign branch. Test: `commitExperiment` creates a commit with correct message format. Test: `revertExperiment` creates a revert commit. Test: after commit + revert, working tree is clean and matches pre-experiment state. Test: dispatch guard allows `run-experiment` for a slice whose dependencies are satisfied.

## Must-Haves

- [ ] `commitExperiment()` produces atomic commit with `experiment(E001): description` message format
- [ ] `revertExperiment()` produces clean revert with `revert(E001): discard — reason` message format
- [ ] Revert is idempotent — doesn't error if already reverted
- [ ] Dispatch guard permits `run-experiment` within a valid slice
- [ ] Public wrappers exported from `worktree.ts`
- [ ] Build passes clean
- [ ] Git integration tests pass

## Verification

- `npm run build` exits 0
- `npm test -- --test-name-pattern "git-experiment"` — all new tests pass
- Existing git-service tests still pass: `npm test -- --test-name-pattern "git-service"`
- Existing dispatch-guard tests still pass: `npm test -- --test-name-pattern "dispatch"`

## Inputs

- `src/resources/extensions/gsd/git-service.ts` — GitServiceImpl class to extend
- `src/resources/extensions/gsd/dispatch-guard.ts` — SLICE_DISPATCH_TYPES set to update
- `src/resources/extensions/gsd/worktree.ts` — public wrapper pattern to follow
- T01 output — research types and Phase union must compile

## Expected Output

- `src/resources/extensions/gsd/git-service.ts` — commitExperiment() and revertExperiment() methods
- `src/resources/extensions/gsd/worktree.ts` — public wrapper functions for experiment git operations
- `src/resources/extensions/gsd/dispatch-guard.ts` — run-experiment in dispatch types
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — integration tests for experiment git operations and dispatch guard

## Observability Impact

- **New runtime signals:** `commitExperiment()` returns a commit hash — callers can verify the commit exists with `git rev-parse`. `revertExperiment()` is idempotent — repeated calls return without error, observable via git log.
- **Inspection surface:** Experiment commits follow `experiment(E001): {desc}` format; revert commits follow `revert(E001): discard — {reason}` format. Both are discoverable via `git log --oneline --grep="experiment("` on the campaign branch.
- **Failure visibility:** `commitExperiment()` throws if staging or commit fails (e.g. nothing to commit). `revertExperiment()` surfaces the "already reverted" case silently (idempotent) but throws on other git failures.
- **Dispatch guard:** `run-experiment` added to `SLICE_DISPATCH_TYPES` — observable via `getPriorSliceCompletionBlocker()` returning null/blocker for experiment dispatches.
