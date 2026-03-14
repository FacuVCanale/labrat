---
id: T01
parent: S03
milestone: M001
provides:
  - eval-runner.ts with full eval pipeline (subprocess, parsing, aggregation, scoring, decisions, log I/O, orchestrator)
  - contract test suite with 66 assertions covering all functions and edge cases
key_files:
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/eval-runner.test.ts
key_decisions:
  - Bottom-up JSON scanning in parseMetrics — takes the last valid JSON object line, which works well with eval tools that print progress then final metrics
  - Median aggregation chosen over mean for multi-run robustness against outliers
  - Zero baseline guard uses divisor of 1 (not epsilon) to produce meaningful normalized scores
patterns_established:
  - Eval pipeline functions are all pure and independently testable except runEval (subprocess) and log I/O
  - runExperimentPostProcess orchestrates the full pipeline and handles all edge cases (missing config, all runs fail, timeout)
observability_surfaces:
  - ExperimentResult.decision.reason — distinct strings for first experiment, improvement, regression, timeout, crash, missing config
  - EXPERIMENT-LOG.jsonl — append-only, each line a full ExperimentResult with per-metric comparison
  - readBestMetrics(sliceDir) — retrieves current best from log for baseline comparison
duration: 15m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Build eval engine module with contract tests

**Built complete eval pipeline with 8 exported functions and 66-assertion contract test suite.**

## What Happened

Created `eval-runner.ts` with the full evaluation pipeline:

1. **`runEval`** — subprocess execution via `spawnSync` with timeout, distinguishes success/crash/timeout via exit code and signal detection
2. **`parseMetrics`** — bottom-up line scanning for JSON, filters to finite numeric values only
3. **`aggregateMetrics`** — median computation across multiple runs (handles odd/even counts, missing metrics, empty runs)
4. **`computeCompositeScore`** — direction-aware (`min`/`max`) weighted scoring with weight normalization and zero-baseline guard
5. **`makeKeepDiscardDecision`** — null baseline → auto-keep; positive score → keep; zero/negative → discard with per-metric comparison
6. **`readBestMetrics`** — scans EXPERIMENT-LOG.jsonl for latest kept experiment, skips unparseable lines
7. **`appendExperimentLog`** — crash-safe append via `appendFileSync`
8. **`runExperimentPostProcess`** — orchestrator that ties everything together with git revert on discard

Test suite covers all functions with 66 assertions across: metric parsing (clean JSON, mixed output, no JSON, non-numeric filtering, NaN/Infinity, array rejection, bottom-up scanning), median aggregation (odd/even counts, single run, empty runs, mixed metrics), composite scoring (max/min direction, weighted multi-metric, weight normalization, zero baseline, zero total weight, empty defs), keep/discard decisions (first experiment, improvement, regression, no change), experiment log I/O (create, append, read best, skip bad lines, all discarded), subprocess execution (success, failure, timeout, stderr capture), and an integration test (multi-run parse + aggregate pipeline).

## Verification

- `npm test -- eval-runner.test.ts` — 66 passed, 0 failed ✓
- `npm run build` — exits 0, no type errors ✓
- `npm test -- research-types.test.ts` — 33 passed ✓
- `npm test -- git-experiment.test.ts` — 14 passed ✓
- `npm test -- dispatch-guard.test.ts` — 4 passed ✓
- `npm test -- derive-state.test.ts` — 106 passed ✓

## Diagnostics

- `readBestMetrics(sliceDir)` returns current best metrics for any slice
- `grep 'discard\|keep' EXPERIMENT-LOG.jsonl` for decision history
- Decision reasons are distinct per failure mode: "missing or invalid campaign config", "eval timed out after Ns", "all N eval run(s) failed", "first experiment — establishes baseline", "composite score X.XXXX > 0 — improvement", "composite score X.XXXX <= 0 — regression"

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/eval-runner.ts` — complete eval engine module with 8 exported functions
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — contract tests with 66 assertions
