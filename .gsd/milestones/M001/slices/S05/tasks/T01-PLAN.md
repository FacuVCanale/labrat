---
estimated_steps: 7
estimated_files: 7
---

# T01: Experiment log enrichment, max-experiment guard & crash recovery

**Slice:** S05 — Experiment Log, Crash Recovery & Supervision
**Milestone:** M001

## Description

Add `timestamp` to `ExperimentResult` and populate it in the eval pipeline. Fix `deriveState` to return `summarizing` when experiments reach the configured max. Enrich the crash lock with experiment number at dispatch time. Add orphan commit detection and revert on restart. Handle `run-experiment` in timeout recovery. Update `lastProgressAt` after eval to prevent false idle triggers. Write contract tests proving all behaviors.

## Steps

1. Add optional `timestamp: string` field to `ExperimentResult` in `types.ts`. Populate it with `new Date().toISOString()` in `runExperimentPostProcess` (in `eval-runner.ts`) at each of the three result construction sites.

2. In `state.ts` `deriveState`, add a guard after `countExperiments`: if `experimentsDone >= campaign.maxExperiments`, return a state with `phase: 'summarizing'` instead of `'experimenting'`. The `nextAction` should indicate the campaign is complete.

3. In `auto.ts` `dispatchNextUnit`, at the `experimenting` branch (~line 1313), capture `expNum` and pass it to the `writeLock` call at ~line 1489. The `LockData` interface already has `experimentNumber` — just need to write it. Approach: store `expNum` in a variable scoped to the function, then after the existing `writeLock` call, do a read-modify-write to add `experimentNumber` (since `writeLock` uses positional args and doesn't accept it).

4. In `auto.ts` `startAuto`, expand the crash recovery block (~line 412-435). After existing recovery logic, if `crashLock.unitType === 'run-experiment'`, detect orphan commits: compare `countExperiments(sliceDir)` against the count of `experiment(E*)` commits in git log. If git has more commits than JSONL entries, revert the orphan using `gitService.revertExperiment()`. Notify via `ctx.ui.notify`.

5. In `auto.ts` `recoverTimedOutUnit`, add a `run-experiment` case. Check if the experiment was logged (JSONL entry exists for this experiment number). If not logged, revert the last commit (orphan experiment). Update runtime record. Dispatch next unit.

6. In `auto.ts` `handleAgentEnd`, after the experiment post-processing try/catch block (~line 575), update `lastProgressAt` on the unit runtime record to `Date.now()` to prevent false idle detection after long eval runs.

7. Write `src/resources/extensions/gsd/tests/supervision.test.ts` with contract tests:
   - `ExperimentResult` timestamp is populated by `runExperimentPostProcess`
   - `deriveState` returns `summarizing` when experiments >= max
   - `deriveState` returns `experimenting` when experiments < max
   - `formatCrashInfo` includes experiment number when present in lock data
   - `writeLock` / `readCrashLock` round-trips `experimentNumber` field
   - Orphan detection logic (mock git log count vs JSONL count)

## Must-Haves

- [ ] `ExperimentResult.timestamp` field exists and is populated in all three result construction paths
- [ ] `deriveState` returns `summarizing` when `experimentsDone >= maxExperiments`
- [ ] Lock file contains `experimentNumber` during experiment dispatch
- [ ] Crash recovery block handles `run-experiment` unit type with orphan detection
- [ ] `recoverTimedOutUnit` has a `run-experiment` case
- [ ] `lastProgressAt` updated after eval completion
- [ ] Contract tests pass for all behaviors

## Verification

- `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — all assertions pass
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — existing + new tests pass
- `npm run build` — exits 0, no type errors

## Observability Impact

- Signals added: `ExperimentResult.timestamp` on every JSONL entry; `experimentNumber` in lock file during dispatch; UI notification on orphan commit detection/revert
- How a future agent inspects this: read `auto.lock` for in-flight experiment number; grep JSONL for timestamps; check `formatCrashInfo` output for experiment context
- Failure state exposed: orphan commit count and revert status in crash recovery notification

## Inputs

- `src/resources/extensions/gsd/types.ts` — `ExperimentResult` interface (line 213)
- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess` with three result construction sites
- `src/resources/extensions/gsd/state.ts` — `deriveState` campaign detection block (line 410)
- `src/resources/extensions/gsd/auto.ts` — crash recovery (line 412), dispatch (line 1308), timeout recovery (line 2626), handleAgentEnd (line 553)
- `src/resources/extensions/gsd/crash-recovery.ts` — `LockData` with existing `experimentNumber` field, `writeLock`, `readCrashLock`, `formatCrashInfo`
- S03 summary — eval pipeline architecture, JSONL format, post-processing hook placement

## Expected Output

- `src/resources/extensions/gsd/types.ts` — `ExperimentResult` with `timestamp?: string`
- `src/resources/extensions/gsd/eval-runner.ts` — timestamp populated in all result paths
- `src/resources/extensions/gsd/state.ts` — max-experiment guard returning `summarizing`
- `src/resources/extensions/gsd/auto.ts` — lock enrichment, orphan detection, timeout handler, lastProgressAt update
- `src/resources/extensions/gsd/crash-recovery.ts` — `formatCrashInfo` shows experiment number
- `src/resources/extensions/gsd/tests/supervision.test.ts` — contract test suite
