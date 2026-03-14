# S03: Eval Runner & Keep/Discard Engine — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All eval pipeline functions are pure with contract tests. The handleAgentEnd wiring is verified by build compilation and hook placement. No live runtime or human-experience verification needed — the eval subprocess is tested with real `echo` commands in the test suite.

## Preconditions

- Repository cloned and dependencies installed (`npm install`)
- `npm run build` exits 0
- Node.js and `npx tsx` available

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — should report 66 passed, 0 failed.

## Test Cases

### 1. Metric parsing from clean JSON stdout

1. Call `parseMetrics('{"loss": 0.5, "accuracy": 0.95}\n')`
2. **Expected:** Returns `{ loss: 0.5, accuracy: 0.95 }`

### 2. Metric parsing from mixed stdout (progress bars, warnings, then JSON)

1. Call `parseMetrics('Loading model...\nEpoch 1/10 [====] 100%\nWARNING: lr high\n{"val_loss": 0.42, "val_acc": 0.91}\n')`
2. **Expected:** Returns `{ val_loss: 0.42, val_acc: 0.91 }` — non-JSON lines ignored, last JSON line used

### 3. Non-numeric fields filtered out

1. Call `parseMetrics('{"loss": 0.5, "model_name": "bert", "status": true, "accuracy": 0.9}\n')`
2. **Expected:** Returns `{ loss: 0.5, accuracy: 0.9 }` — string and boolean fields excluded

### 4. No JSON in stdout

1. Call `parseMetrics('Training complete.\nNo metrics output.\n')`
2. **Expected:** Returns `null`

### 5. Median aggregation across odd number of runs

1. Call `aggregateMetrics([{ loss: 0.5 }, { loss: 0.3 }, { loss: 0.4 }])`
2. **Expected:** Returns `{ loss: 0.4 }` (median of sorted [0.3, 0.4, 0.5])

### 6. Median aggregation with even number of runs

1. Call `aggregateMetrics([{ loss: 0.5 }, { loss: 0.3 }, { loss: 0.4 }, { loss: 0.6 }])`
2. **Expected:** Returns `{ loss: 0.45 }` (average of middle two: (0.4 + 0.5) / 2)

### 7. Composite scoring — single metric, maximize direction

1. Define metric def: `[{ name: "accuracy", direction: "max", weight: 1 }]`
2. Call `computeCompositeScore({ accuracy: 0.95 }, { accuracy: 0.90 }, defs)`
3. **Expected:** Positive score (improvement from 0.90 → 0.95)

### 8. Composite scoring — single metric, minimize direction

1. Define metric def: `[{ name: "loss", direction: "min", weight: 1 }]`
2. Call `computeCompositeScore({ loss: 0.3 }, { loss: 0.5 }, defs)`
3. **Expected:** Positive score (loss decreased from 0.5 → 0.3, which is improvement for min)

### 9. Composite scoring — regression detected

1. Define metric def: `[{ name: "accuracy", direction: "max", weight: 1 }]`
2. Call `computeCompositeScore({ accuracy: 0.85 }, { accuracy: 0.90 }, defs)`
3. **Expected:** Negative score (accuracy decreased)

### 10. Keep/discard — first experiment (no baseline)

1. Call `makeKeepDiscardDecision(metrics, null, config)` with valid metrics and null baseline
2. **Expected:** Decision is `keep` with reason containing "first experiment"

### 11. Keep/discard — improvement over baseline

1. Call `makeKeepDiscardDecision(current, baseline, config)` where current has better composite score
2. **Expected:** Decision is `keep` with reason containing "improvement"

### 12. Keep/discard — regression from baseline

1. Call `makeKeepDiscardDecision(current, baseline, config)` where current has worse composite score
2. **Expected:** Decision is `discard` with reason containing "regression"

### 13. Experiment log — create, append, read back

1. Create temp directory
2. Call `appendExperimentLog(dir, result1)` then `appendExperimentLog(dir, result2)`
3. Call `readBestMetrics(dir)` where result1 was kept and result2 was discarded
4. **Expected:** EXPERIMENT-LOG.jsonl has 2 lines, each valid JSON. `readBestMetrics` returns result1's metrics (last kept).

### 14. Subprocess execution — successful command

1. Call `runEval('echo \'{"loss": 0.5}\'', 10, cwd)`
2. **Expected:** Returns `{ stdout containing the JSON, exitCode: 0, timedOut: false }`

### 15. Subprocess execution — timeout

1. Call `runEval('sleep 60', 1, cwd)`
2. **Expected:** Returns `{ timedOut: true }` — does not hang for 60 seconds

### 16. handleAgentEnd wiring

1. Confirm `grep -n 'runExperimentPostProcess' src/resources/extensions/gsd/auto.ts` shows import and call site
2. Confirm call site is after the auto-commit block and before doctor/state-rebuild
3. **Expected:** Import at top of file, call around line 560, wrapped in try/catch with `currentUnit.type === "run-experiment"` guard

## Edge Cases

### NaN and Infinity filtering

1. Call `parseMetrics('{"loss": NaN, "acc": Infinity, "val_loss": 0.5}\n')` — note: NaN/Infinity are not valid JSON, so this tests the numeric filtering on values parsed from a line that somehow includes them
2. **Expected:** Only finite numeric values returned; NaN and Infinity excluded

### Array JSON line rejected

1. Call `parseMetrics('[1, 2, 3]\n{"loss": 0.5}\n')`
2. **Expected:** Returns `{ loss: 0.5 }` — array line skipped, object line used

### Zero baseline guard

1. Call `computeCompositeScore({ loss: 0.5 }, { loss: 0 }, defs)` with min direction
2. **Expected:** Does not divide by zero; produces a meaningful score using divisor of 1

### All eval runs fail

1. Call `runExperimentPostProcess` where all N eval runs produce null metrics
2. **Expected:** Experiment is discarded with reason "all N eval run(s) failed"

### Missing campaign config

1. Call `runExperimentPostProcess` with a sliceDir that has no CAMPAIGN.json
2. **Expected:** Experiment is discarded with reason "missing or invalid campaign config"

## Failure Signals

- Any test in `eval-runner.test.ts` failing indicates a contract regression
- `npm run build` type errors in eval-runner.ts or auto.ts
- Missing `runExperimentPostProcess` import or call in auto.ts
- eval-runner.ts functions returning undefined instead of null for missing data
- EXPERIMENT-LOG.jsonl with malformed lines (not valid JSON per line)

## Requirements Proved By This UAT

- R003 — Experiment loop pipeline: eval → parse → compare → keep/revert proven by test cases 1-16
- R004 — Multi-metric evaluation: weighted scoring, direction handling, timeout, multi-run median proven by test cases 5-9, 15

## Not Proven By This UAT

- R003 full loop integration — the modify → commit → eval → compare cycle is wired but not tested end-to-end with a real LLM producing modifications (that's S04 + S07)
- R010 crash recovery — EXPERIMENT-LOG.jsonl format is crash-safe by design (appendFileSync) but crash-recovery logic lives in S05
- Live eval execution during an actual autonomous campaign run (S07 smoke test)

## Notes for Tester

- All test cases are already automated in `eval-runner.test.ts`. The UAT describes what those tests prove. Running the test file is the primary verification method.
- The handleAgentEnd wiring (test case 16) is verified by code inspection and build compilation rather than a live runtime test, since running the full dispatch loop requires LLM credentials and a campaign setup.
