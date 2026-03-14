---
id: S05
parent: M001
milestone: M001
provides:
  - ExperimentResult.timestamp populated in all result paths
  - deriveState max-experiment guard returning summarizing phase
  - Lock file enrichment with experimentNumber at dispatch
  - Crash recovery orphan commit detection and revert for run-experiment
  - Timeout recovery run-experiment case (revert orphan, dispatch next)
  - lastProgressAt update after eval completion
  - formatCrashInfo experiment number display
  - Per-experiment budget guard in handleAgentEnd (pauses on overspend, degrades on zero cost)
  - Campaign-level budget_ceiling verified for experiment workflows
requires:
  - slice: S03
    provides: eval runner (runExperimentPostProcess, countExperiments, readAllExperiments), keep/discard engine, ExperimentResult type
affects:
  - S07
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/crash-recovery.ts
  - src/resources/extensions/gsd/tests/supervision.test.ts
  - src/resources/extensions/gsd/tests/derive-state.test.ts
key_decisions:
  - Lock enrichment via read-modify-write after writeLock preserves backward compatibility
  - Orphan detection uses git log --grep to count experiment commits vs JSONL entries
  - Per-experiment budget computed inline from session entries (same pattern as snapshotUnitMetrics)
  - Per-experiment budget uses strict > (at-budget is OK), campaign-level uses >= (at-or-over triggers)
  - Budget check wrapped in try/catch with non-fatal semantics — budget failure never blocks dispatch
patterns_established:
  - ExperimentResult always carries timestamp for traceability
  - Lock file carries experimentNumber during experiment dispatch for crash diagnostics
  - Budget guard reads cost from session entries using the same extraction pattern as snapshotUnitMetrics
  - Budget check failure is non-fatal — swallowed and logged
observability_surfaces:
  - ExperimentResult.timestamp on every JSONL entry
  - auto.lock contains experimentNumber during experiment dispatch
  - formatCrashInfo includes experiment number when present
  - UI notification on orphan commit detection and revert
  - UI notification on per-experiment budget exceeded (actual cost vs budget)
  - lastProgressAt updated after eval to prevent false idle triggers
  - Zero-cost graceful degradation is silent (no false pause)
drill_down_paths:
  - .gsd/milestones/M001/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S05/tasks/T02-SUMMARY.md
duration: 35min
verification_result: passed
completed_at: 2026-03-13
---

# S05: Experiment Log, Crash Recovery & Supervision

**Crash-survivable experiment log with orphan commit detection, max-experiment guard, per-experiment and campaign-level budget ceilings, timeout recovery for run-experiment units, and idle detection prevention.**

## What Happened

**T01** added the data integrity and crash recovery foundation. `ExperimentResult.timestamp` is now populated in all three result construction paths in `runExperimentPostProcess` (missing config, all runs failed, normal result). The max-experiment guard in `deriveState` returns `summarizing` phase when `experimentsDone >= maxExperiments`, preventing unbounded loops. Lock file enrichment writes `experimentNumber` via read-modify-write after `writeLock` during experiment dispatch, enabling crash diagnostics. Crash recovery in `startAuto` now handles `run-experiment` interruptions: it counts experiment commits in git log vs JSONL entries and reverts orphan commits (committed but not logged). The `recoverTimedOutUnit` handler for `run-experiment` checks JSONL for the result, reverts orphan commits, and dispatches the next unit. `lastProgressAt` is updated after eval completion to prevent false idle triggers during long eval runs. `formatCrashInfo` includes experiment number when present.

**T02** added the per-experiment budget guard. After experiment post-processing in `handleAgentEnd`, the guard loads `budget_per_experiment` from research preferences, computes the experiment's cost by scanning session entries, and pauses auto-mode with a cost-detail notification if cost exceeds budget. Zero-cost providers are silently skipped (no false pauses). The guard is wrapped in try/catch so budget check failures never block experiment dispatch. Campaign-level `budget_ceiling` was verified to work correctly for experiment workflows.

## Verification

- `npx tsx supervision.test.ts` — 37 passed, 0 failed ✓ (covers R007, R008, R009, R010)
- `npx tsx derive-state.test.ts` — 113 passed, 0 failed ✓ (includes 7 new max-experiment assertions)
- `npx tsx eval-runner.test.ts` — 73 passed, 0 failed ✓
- `npx tsx research-types.test.ts` — 33 passed, 0 failed ✓
- `npx tsx dispatch-guard.test.ts` — 4 passed, 0 failed ✓
- `npx tsx git-experiment.test.ts` — 14 passed, 0 failed ✓
- `npm run build` — exits 0, no type errors ✓

## Requirements Advanced

- R007 (Crash Recovery for Experiments) — orphan commit detection in startAuto, run-experiment timeout handler, lock enrichment with experiment number
- R008 (Cost & Token Tracking with Budget Ceiling) — per-experiment budget guard pauses on overspend, campaign-level ceiling verified
- R009 (Timeout & Idle Supervision) — run-experiment case in recoverTimedOutUnit, lastProgressAt updated after eval
- R010 (Experiment Log) — timestamp field on all ExperimentResult entries, crash-survivable JSONL format verified

## Requirements Validated

- R007 — orphan commit detection and revert proven by contract tests; lock enrichment carries experiment number for diagnostics
- R008 — per-experiment budget guard pauses on overspend, degrades gracefully on zero cost, campaign-level ceiling triggers at-or-over — all proven by 11 budget-specific contract tests
- R009 — run-experiment timeout handler proven by contract tests; lastProgressAt update prevents false idle detection
- R010 — timestamp populated in all result paths; crash-survivable JSONL format; queryable and sortable — proven by contract tests

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

- Orphan detection relies on git log --grep for experiment commit messages matching D014 convention. If commit messages are manually altered, orphan detection may miss commits.
- Per-experiment budget check reads cost from session entries after the experiment completes — it cannot prevent overspend mid-experiment, only pause before the next one starts.
- Zero-cost providers silently skip budget checks. No warning is emitted, so users with zero-cost reporting won't know the guard is inactive.

## Follow-ups

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `timestamp?: string` to ExperimentResult
- `src/resources/extensions/gsd/eval-runner.ts` — populated timestamp in all three result construction paths
- `src/resources/extensions/gsd/state.ts` — added max-experiment guard returning summarizing phase
- `src/resources/extensions/gsd/auto.ts` — lock enrichment, orphan detection in crash recovery, run-experiment timeout handler, lastProgressAt update, per-experiment budget guard
- `src/resources/extensions/gsd/crash-recovery.ts` — formatCrashInfo includes experiment number
- `src/resources/extensions/gsd/tests/supervision.test.ts` — 37 contract tests (26 from T01, 11 from T02)
- `src/resources/extensions/gsd/tests/derive-state.test.ts` — 7 new max-experiment assertions

## Forward Intelligence

### What the next slice should know
- S06 (MLOps integration) can hook into the same post-processing block in `handleAgentEnd` where eval results are processed — the `ExperimentResult` now carries `timestamp`, full metrics, and the keep/discard decision
- The JSONL experiment log is the authoritative record — `readAllExperiments()` returns all entries, `countExperiments()` returns the count
- `budget_per_experiment` and `budget_ceiling` are in `GSDResearchPreferences` — loaded via `loadEffectiveGSDPreferences()`

### What's fragile
- Orphan detection depends on D014 commit message convention (`experiment(EYYY):`) — changing commit format without updating the grep pattern breaks crash recovery
- Budget guard reads session entries with the same extraction pattern as `snapshotUnitMetrics` — if the cost field format changes in the metrics ledger, both sites need updating

### Authoritative diagnostics
- `supervision.test.ts` — 37 assertions covering all four requirements (R007-R010), the most concentrated verification of operational behavior
- `auto.lock` during experiment dispatch — read this file to see `experimentNumber` for crash diagnostics
- EXPERIMENT-LOG.jsonl `"timestamp":` field — grep for this to verify all entries carry timestamps

### What assumptions changed
- No assumptions changed — the slice plan was accurate and both tasks completed without deviations
