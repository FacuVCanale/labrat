---
id: T01
parent: S05
milestone: M001
provides:
  - ExperimentResult.timestamp field populated in all result paths
  - deriveState max-experiment guard returning summarizing phase
  - Lock file enrichment with experimentNumber at dispatch
  - Crash recovery orphan commit detection for run-experiment
  - Timeout recovery run-experiment case
  - lastProgressAt update after eval completion
  - formatCrashInfo experiment number display
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/crash-recovery.ts
  - src/resources/extensions/gsd/tests/supervision.test.ts
  - src/resources/extensions/gsd/tests/derive-state.test.ts
key_decisions:
  - Lock enrichment via read-modify-write after writeLock rather than changing writeLock signature (preserves backward compatibility)
  - Orphan detection uses git log --grep to count experiment commits vs JSONL entries
patterns_established:
  - ExperimentResult always carries timestamp for traceability
  - Lock file carries experimentNumber during experiment dispatch for crash diagnostics
observability_surfaces:
  - ExperimentResult.timestamp on every JSONL entry
  - auto.lock contains experimentNumber during experiment dispatch
  - formatCrashInfo includes experiment number when present
  - UI notification on orphan commit detection and revert
  - lastProgressAt updated after eval to prevent false idle triggers
duration: 25min
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Experiment log enrichment, max-experiment guard & crash recovery

**Added timestamp to ExperimentResult, max-experiment guard in deriveState, lock enrichment with experiment number, orphan commit detection in crash recovery, run-experiment timeout handler, and lastProgressAt update after eval.**

## What Happened

1. Added `timestamp?: string` to `ExperimentResult` in types.ts. Populated with `new Date().toISOString()` in all three result construction sites in `runExperimentPostProcess` (missing config, all runs failed, normal result).

2. Added max-experiment guard in `deriveState`: when `experimentsDone >= campaign.maxExperiments`, returns `phase: 'summarizing'` with an appropriate nextAction message instead of continuing to experiment.

3. In `dispatchNextUnit`, captured `expNum` in `dispatchedExpNum` variable, then after `writeLock` call, enriched the lock file with `experimentNumber` via read-modify-write.

4. Expanded crash recovery in `startAuto` to handle `run-experiment` crashes: counts experiment commits in git log vs JSONL entries, reverts orphan commits (committed but not logged), and notifies via UI.

5. Added `run-experiment` case in `recoverTimedOutUnit`: checks if the experiment was logged in JSONL, reverts orphan commits with experiment commit messages, updates runtime record, and dispatches next unit.

6. After experiment post-processing in `handleAgentEnd`, updates `lastProgressAt` with `lastProgressKind: "eval-complete"` to prevent false idle triggers during long eval runs.

7. Updated `formatCrashInfo` to include experiment number when `lock.experimentNumber` is defined.

8. Wrote contract tests in `supervision.test.ts` (26 assertions) and added 7 new assertions to `derive-state.test.ts`.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — 26 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — 113 passed, 0 failed ✓
- `npm run build` — exits 0, no type errors ✓

## Diagnostics

- Read `auto.lock` during experiment dispatch to see `experimentNumber` field
- Grep EXPERIMENT-LOG.jsonl for `"timestamp":` to verify all entries carry timestamps
- Check `formatCrashInfo` output for "Experiment number:" line in crash recovery notifications
- Orphan detection logs count and reverted hash in UI notification

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `timestamp?: string` to ExperimentResult
- `src/resources/extensions/gsd/eval-runner.ts` — populated timestamp in all three result construction paths
- `src/resources/extensions/gsd/state.ts` — added max-experiment guard returning summarizing phase
- `src/resources/extensions/gsd/auto.ts` — lock enrichment, orphan detection in crash recovery, run-experiment timeout handler, lastProgressAt update, revertExperiment import
- `src/resources/extensions/gsd/crash-recovery.ts` — formatCrashInfo includes experiment number
- `src/resources/extensions/gsd/tests/supervision.test.ts` — new contract test suite (26 assertions)
- `src/resources/extensions/gsd/tests/derive-state.test.ts` — added campaign phase tests (7 new assertions)
