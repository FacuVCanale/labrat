---
id: S03
parent: M001
milestone: M001
provides:
  - eval-runner.ts with full eval pipeline (subprocess, parsing, median aggregation, weighted composite scoring, keep/discard decisions, JSONL experiment log I/O, orchestrator)
  - handleAgentEnd wiring so run-experiment units trigger eval post-processing automatically after auto-commit
requires:
  - slice: S02
    provides: Research types (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision), commitExperiment/revertExperiment, countExperiments, campaign config parsing
affects:
  - S05 (crash recovery consumes eval runner lifecycle events, experiment log format)
  - S06 (MLOps integration consumes ExperimentResult with metrics and decision data)
key_files:
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/eval-runner.test.ts
  - src/resources/extensions/gsd/auto.ts
key_decisions:
  - Bottom-up JSON scanning in parseMetrics — last valid JSON object line wins, compatible with eval tools that print progress then final metrics
  - Median aggregation over mean for multi-run robustness against outliers
  - Zero baseline guard uses divisor of 1 (not epsilon) for meaningful normalized scores
  - Eval hook placed between auto-commit and doctor/state-rebuild — eval sees committed code, doctor runs after any revert
  - UI notification severity varies by decision type (info=keep, warn=discard, error=eval crash)
patterns_established:
  - Eval pipeline functions are pure and independently testable except runEval (subprocess) and log I/O
  - Non-fatal post-processing hooks in handleAgentEnd use try/catch + ctx.ui.notify pattern
  - EXPERIMENT-LOG.jsonl is the single source of truth for experiment history, crash-safe via appendFileSync
observability_surfaces:
  - ExperimentResult.decision.reason — distinct strings per failure mode (timeout, crash, first experiment, improvement, regression, missing config)
  - EXPERIMENT-LOG.jsonl — append-only, one full ExperimentResult per line, greppable for keep/discard
  - readBestMetrics(sliceDir) — retrieves current best metrics from log for baseline comparison
  - UI notifications per experiment with decision verb, reason, and metric values
drill_down_paths:
  - .gsd/milestones/M001/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T02-SUMMARY.md
duration: 27m
verification_result: passed
completed_at: 2026-03-13
---

# S03: Eval Runner & Keep/Discard Engine

**Complete eval pipeline — subprocess execution with timeout, JSON metric parsing, median aggregation, weighted composite scoring, keep/discard decisions with git operations, JSONL experiment log, and auto.ts wiring.**

## What Happened

Built the eval engine as a new module (`eval-runner.ts`) with 8 exported functions covering the full evaluation pipeline:

**T01** created the core engine: `runEval` executes user-defined eval commands via `spawnSync` with configurable timeout, distinguishing success/crash/timeout. `parseMetrics` scans stdout bottom-up for the last valid JSON line and filters to finite numeric values. `aggregateMetrics` computes medians across multiple runs. `computeCompositeScore` does direction-aware (`min`/`max`) weighted scoring with weight normalization and zero-baseline guards. `makeKeepDiscardDecision` handles all cases: null baseline auto-keeps, positive score keeps, zero/negative discards, with per-metric before/after comparison in the reason. `readBestMetrics` and `appendExperimentLog` handle crash-safe JSONL I/O. `runExperimentPostProcess` orchestrates the full pipeline including git revert on discard.

**T02** wired the engine into `handleAgentEnd` in auto.ts. When a `run-experiment` unit completes, the hook fires between auto-commit and doctor/state-rebuild. It derives slice directory from unit ID, gets HEAD commit hash, calculates experiment number, and calls `runExperimentPostProcess`. Results appear as UI notifications. Eval failures are non-fatal — the dispatch loop continues.

## Verification

- `npx tsx eval-runner.test.ts` — 66 assertions passed, 0 failed
- `npm run build` — exits 0, no type errors
- `npx tsx derive-state.test.ts` — 106/106 passed
- `npx tsx dispatch-guard.test.ts` — 4/4 passed
- `npx tsx git-experiment.test.ts` — 14/14 passed
- `npx tsx research-types.test.ts` — 33/33 passed
- Hook placement confirmed at auto.ts line 560, between auto-commit (544) and doctor (581)

## Requirements Advanced

- R003 (Experiment Loop) — eval → parse → compare → keep/revert pipeline fully implemented with contract tests; wired into dispatch loop
- R004 (Multi-Metric Evaluation Framework) — weighted composite scoring, direction-aware normalization, configurable timeout, multi-run median aggregation all proven by contract tests
- R010 (Experiment Log) — EXPERIMENT-LOG.jsonl append-only format with crash-safe writes, read-back for baseline comparison

## Requirements Validated

- R003 — Contract tests prove the full pipeline: subprocess execution, metric parsing from mixed stdout, median aggregation, weighted composite scoring, keep/discard decisions with correct git operations. Integration hook in handleAgentEnd confirmed by build + placement.
- R004 — 66 contract tests cover: direction-aware scoring (min/max), weighted multi-metric composites, weight normalization, zero baseline guard, multi-run median aggregation, timeout enforcement.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Eval subprocess uses `spawnSync` (synchronous) — adequate for eval commands but blocks the Node.js event loop during execution. Acceptable because eval runs are expected to take seconds to minutes and nothing else needs to run concurrently.
- No live streaming of eval output — stdout/stderr captured in bulk after completion. Streaming would require async subprocess management (S05 territory).

## Follow-ups

- none

## Files Created/Modified

- `src/resources/extensions/gsd/eval-runner.ts` — new module with 8 exported functions covering the full eval pipeline
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — contract test suite with 66 assertions
- `src/resources/extensions/gsd/auto.ts` — added imports and ~20-line experiment post-processing block in handleAgentEnd

## Forward Intelligence

### What the next slice should know
- `runExperimentPostProcess` is the single entry point for eval — it handles missing config, all-runs-failed, first-experiment baseline establishment, and git revert on discard
- EXPERIMENT-LOG.jsonl is per-slice (lives in slice directory), one ExperimentResult JSON object per line
- `readBestMetrics(sliceDir)` returns the metrics from the latest kept experiment, or null if none kept yet

### What's fragile
- `parseMetrics` trusts the last valid JSON line in stdout — if an eval tool prints multiple JSON objects, only the last one is used. If the eval tool's progress output happens to be valid JSON, it could mask the real metrics (bottom-up scanning mitigates this but doesn't eliminate it).

### Authoritative diagnostics
- `grep 'discard\|keep' EXPERIMENT-LOG.jsonl` — complete decision history with reasons and per-metric comparisons
- `git log --oneline --grep="revert("` — all reverted experiments with reasons in commit messages
- UI notification stream — search for `"Experiment exp-"` for real-time decision output

### What assumptions changed
- none — implementation matched the plan exactly
