# S05: Experiment Log, Crash Recovery & Supervision — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All supervision behavior (crash recovery, budget guards, timeout handling, max-experiment guard) is exercised by contract tests against the actual functions and state machine. No live runtime or human judgment needed — the behaviors are deterministic and fully testable via unit assertions.

## Preconditions

- Repository cloned and dependencies installed (`npm install`)
- Build passes (`npm run build`)
- Node.js and npx available

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — all 37 assertions pass. This single suite covers crash recovery, budget guards, timeout handling, cost extraction, and max-experiment state transitions.

## Test Cases

### 1. Orphan commit detection on crash recovery

1. Simulate a state where git log contains more experiment commits than JSONL entries (experiment committed but process crashed before writing to log)
2. Run the orphan detection logic from `startAuto` crash recovery
3. **Expected:** Orphan commit is detected, `revertExperiment` is called with the orphan hash, UI notification reports the revert

### 2. Max-experiment guard triggers summarizing phase

1. Set up campaign config with `maxExperiments: 5`
2. Create JSONL with 5 experiment entries (`experimentsDone >= maxExperiments`)
3. Call `deriveState` with this campaign context
4. **Expected:** Returns `phase: 'summarizing'` with nextAction message indicating max experiments reached

### 3. Max-experiment guard does not trigger prematurely

1. Set up campaign config with `maxExperiments: 5`
2. Create JSONL with 4 experiment entries
3. Call `deriveState`
4. **Expected:** Returns `phase: 'experimenting'`, not summarizing

### 4. Per-experiment budget guard pauses on overspend

1. Configure `budget_per_experiment: 0.50` in research preferences
2. Simulate a completed experiment with session entries totaling $0.75
3. Run the budget check from `handleAgentEnd`
4. **Expected:** Pause condition triggered, UI notification shows "$0.75 spent vs $0.50 limit"

### 5. Per-experiment budget guard allows cost at exactly budget

1. Configure `budget_per_experiment: 0.50`
2. Simulate a completed experiment with session entries totaling exactly $0.50
3. Run the budget check
4. **Expected:** No pause triggered (strict > comparison — at-budget is acceptable)

### 6. Per-experiment budget guard degrades on zero cost

1. Configure `budget_per_experiment: 0.50`
2. Simulate a completed experiment where provider reports no cost (entries with no cost field)
3. Run the budget check
4. **Expected:** Check silently skipped, no pause, no error, no warning

### 7. Campaign-level budget ceiling triggers at-or-over

1. Set `budget_ceiling: 10.00` in campaign config
2. Simulate total campaign cost of exactly $10.00
3. Check campaign budget condition
4. **Expected:** Budget ceiling triggers (>= comparison — at-ceiling pauses)

### 8. Run-experiment timeout recovery

1. Simulate a timed-out `run-experiment` unit where the experiment was committed but not logged in JSONL
2. Call `recoverTimedOutUnit` with the run-experiment lock
3. **Expected:** Orphan commit reverted, runtime record updated, next unit dispatched

### 9. Run-experiment timeout recovery with logged result

1. Simulate a timed-out `run-experiment` unit where the experiment IS in JSONL (eval completed but timeout fired late)
2. Call `recoverTimedOutUnit`
3. **Expected:** No revert (result was logged), next unit dispatched normally

### 10. ExperimentResult timestamp populated

1. Run `runExperimentPostProcess` through all three paths: missing config, all runs failed, normal result
2. Check the `ExperimentResult` from each path
3. **Expected:** All three carry `timestamp` field with ISO 8601 format string

### 11. Lock file contains experimentNumber during dispatch

1. Trigger experiment dispatch via `dispatchNextUnit`
2. Read `auto.lock` file during dispatch
3. **Expected:** Lock JSON contains `experimentNumber` field matching the dispatched experiment's number

### 12. formatCrashInfo includes experiment number

1. Create a lock object with `experimentNumber: 3`
2. Call `formatCrashInfo`
3. **Expected:** Output includes "Experiment number: 3" line

### 13. lastProgressAt updated after eval

1. Simulate handleAgentEnd for a run-experiment unit
2. Check `lastProgressAt` after eval post-processing
3. **Expected:** `lastProgressAt` updated with `lastProgressKind: "eval-complete"`

## Edge Cases

### No budget configured

1. Ensure `budget_per_experiment` is undefined in research preferences
2. Run the budget check after experiment completion
3. **Expected:** Check skipped entirely, no error

### Zero budget configured

1. Set `budget_per_experiment: 0` in research preferences
2. Run the budget check after experiment completion
3. **Expected:** Check skipped (zero budget treated as "not configured")

### Cost extraction with mixed entry formats

1. Create session entries with both numeric cost values and object-form costs (e.g., `{ usd: 0.25 }`)
2. Run cost extraction
3. **Expected:** Both formats correctly summed

### maxExperiments set to 0

1. Set `maxExperiments: 0` in campaign config
2. Call `deriveState` with 0 experiments done
3. **Expected:** Immediately returns summarizing phase (0 >= 0 is true)

## Failure Signals

- Any test in `supervision.test.ts` fails — supervision behavior is broken
- Any test in `derive-state.test.ts` fails — state machine regression (max-experiment or existing logic)
- `npm run build` fails — type errors in modified files
- ExperimentResult entries in JSONL missing `timestamp` field
- Budget guard pausing when cost is zero — graceful degradation broken
- Orphan commits not reverted on restart — crash recovery broken

## Requirements Proved By This UAT

- R007 (Crash Recovery) — test cases 1, 8, 9, 11, 12 prove orphan detection, timeout recovery, lock enrichment, and crash info display
- R008 (Budget Ceiling) — test cases 4, 5, 6, 7 prove per-experiment and campaign-level budget guards with edge cases
- R009 (Timeout & Idle Supervision) — test cases 8, 9, 13 prove timeout recovery and idle prevention
- R010 (Experiment Log) — test cases 10, 11 prove timestamp population and structured log enrichment

## Not Proven By This UAT

- Live crash recovery (actual process kill mid-experiment and restart) — tested via contract tests against recovery functions, not by killing a real process
- Real cost data from LLM providers — budget tests use synthetic cost entries
- Full end-to-end loop with all supervision active — integration deferred to S07 smoke test

## Notes for Tester

All test cases are already implemented as contract tests in `supervision.test.ts` and `derive-state.test.ts`. Running these test suites is the primary UAT mechanism. The test cases above describe the logical scenarios those tests exercise — you can verify by reading the test source and confirming the assertions match these scenarios.
