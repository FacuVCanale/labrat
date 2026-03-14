# S05: Experiment Log, Crash Recovery & Supervision

**Goal:** Structured experiment log survives crashes. Kill mid-experiment, restart, resume from clean state. Budget ceiling and per-experiment budget guard prevent overspending. Timeout supervision handles `run-experiment` units. Max-experiment guard stops the loop when done.

**Demo:** Contract tests prove: (1) orphan commit detected and reverted on restart, (2) max-experiment triggers `summarizing` phase, (3) per-experiment budget pauses after overspend, (4) timeout recovery handles `run-experiment`, (5) experiment log entries have timestamps. Build passes.

## Must-Haves

- `ExperimentResult.timestamp` field populated in every log entry
- `deriveState` returns `summarizing` when `experimentsDone >= maxExperiments`
- `writeLock` call enriched with `experimentNumber` during experiment dispatch
- Crash recovery in `startAuto` detects orphan commits (committed but not in JSONL) and reverts them
- `recoverTimedOutUnit` handles `run-experiment` type (revert incomplete, dispatch next)
- Per-experiment budget check in `handleAgentEnd` pauses if single experiment exceeds `budget_per_experiment`
- Campaign-level `budget_ceiling` already works — no change needed, just verified
- `lastProgressAt` updated after eval completes to prevent false idle detection

## Proof Level

- This slice proves: operational (crash recovery, budget, timeout — production-grade supervision)
- Real runtime required: no (all behavior testable via unit/contract tests against functions and state)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — all assertions pass covering R007/R008/R009/R010
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — existing + new max-experiment tests pass
- `npm run build` — no type errors

## Observability / Diagnostics

- Runtime signals: `formatCrashInfo` enriched with experiment number; UI notifications on orphan revert, budget pause, timeout recovery
- Inspection surfaces: `auto.lock` JSON contains `experimentNumber` during experiment dispatch; EXPERIMENT-LOG.jsonl entries have `timestamp`
- Failure visibility: orphan commit count logged on recovery; per-experiment cost vs budget in pause notification
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `eval-runner.ts` (runExperimentPostProcess, countExperiments, readAllExperiments), `crash-recovery.ts` (writeLock, readCrashLock), `state.ts` (deriveState), `auto.ts` (handleAgentEnd, dispatchNextUnit, recoverTimedOutUnit, startAuto), `metrics.ts` (snapshotUnitMetrics, getLedger), `preferences.ts` (GSDResearchPreferences), `git-service.ts` (revertExperiment)
- New wiring introduced in this slice: experiment-aware crash recovery in startAuto, run-experiment handler in recoverTimedOutUnit, per-experiment budget guard in handleAgentEnd, max-experiment state guard in deriveState
- What remains before the milestone is truly usable end-to-end: S06 (MLOps integration), S07 (CLI + smoke test)

## Tasks

- [x] **T01: Experiment log enrichment, max-experiment guard & crash recovery** `est:45m`
  - Why: Delivers R007 (crash recovery) and R010 (log enrichment) — the data integrity guarantees. Also adds the max-experiment guard (prerequisite for R009's scope). These are tightly coupled: the lock file enrichment enables crash recovery, the timestamp enrichment completes the log contract, and the max-experiment guard prevents unbounded loops.
  - Files: `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/state.ts`, `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/crash-recovery.ts`, `src/resources/extensions/gsd/tests/supervision.test.ts`
  - Do: (1) Add `timestamp` to `ExperimentResult`, populate in `runExperimentPostProcess`. (2) Add max-experiment guard in `deriveState` — return `summarizing` when `experimentsDone >= maxExperiments`. (3) Enrich `writeLock` call at dispatch with `experimentNumber`. (4) Add orphan commit detection/revert in `startAuto` crash recovery block — compare `countExperiments` vs experiment commit count in git log, revert orphan if found. (5) Add `run-experiment` case in `recoverTimedOutUnit` — check JSONL for result, revert if missing, dispatch next. (6) Update `lastProgressAt` after eval completes in `handleAgentEnd`. (7) Write contract tests.
  - Verify: `npx tsx supervision.test.ts` passes, `npx tsx derive-state.test.ts` passes, `npm run build` passes
  - Done when: crash recovery detects/reverts orphan commits, max-experiment triggers summarizing, timeout handles experiments, log has timestamps — all proven by tests

- [x] **T02: Per-experiment budget guard and full verification** `est:30m`
  - Why: Delivers R008 (budget ceiling) and R009 (timeout/supervision verified). Per-experiment budget is a guard in `handleAgentEnd` that reads the just-completed unit's cost from the metrics ledger and pauses if it exceeds `budget_per_experiment`. Also adds tests proving the existing campaign-level `budget_ceiling` works for experiments.
  - Files: `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/tests/supervision.test.ts`
  - Do: (1) After experiment post-processing in `handleAgentEnd`, snapshot unit metrics and check cost against `budget_per_experiment` from research preferences. If exceeded, notify and pause. Degrade gracefully if cost is 0 (provider didn't report). (2) Extend supervision test suite with budget guard tests — per-experiment over-budget pauses, zero-cost degrades, campaign-level ceiling verified. (3) Run full test suite to confirm no regressions.
  - Verify: `npx tsx supervision.test.ts` passes with budget tests, all existing test suites pass, `npm run build` passes
  - Done when: per-experiment budget guard pauses on overspend, degrades on zero cost, campaign ceiling verified — all proven by tests

## Files Likely Touched

- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/eval-runner.ts`
- `src/resources/extensions/gsd/state.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/crash-recovery.ts`
- `src/resources/extensions/gsd/preferences.ts`
- `src/resources/extensions/gsd/tests/supervision.test.ts`
- `src/resources/extensions/gsd/tests/derive-state.test.ts`
