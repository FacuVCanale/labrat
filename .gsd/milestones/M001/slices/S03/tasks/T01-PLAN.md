---
estimated_steps: 8
estimated_files: 2
---

# T01: Build eval engine module with contract tests

**Slice:** S03 — Eval Runner & Keep/Discard Engine
**Milestone:** M001

## Description

Create `eval-runner.ts` with all pure functions for the eval pipeline: subprocess execution, JSON metric parsing from mixed stdout, median aggregation for multi-run evals, direction-aware weighted composite scoring, keep/discard decision logic, experiment log I/O, and the orchestrator function that ties the pipeline together with git operations. Write comprehensive contract tests following the existing test patterns.

## Steps

1. Create `eval-runner.ts` with imports from `types.ts` (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig), `worktree.ts` (revertExperiment), and `state.ts` (parseCampaignConfig, countExperiments). Use `spawnSync` from `child_process`, `appendFileSync`/`readFileSync` from `fs`.

2. Implement `runEval(command: string, timeoutSecs: number, cwd: string): { stdout: string; stderr: string; exitCode: number | null; signal: string | null; timedOut: boolean }`. Use `spawnSync` with `shell: true`, `timeout: timeoutSecs * 1000`, `maxBuffer: 10MB`. Detect timeout via `result.signal === 'SIGTERM'` or `result.signal === 'SIGKILL'`. Capture stdout/stderr as strings.

3. Implement `parseMetrics(stdout: string): Record<string, number>`. Scan lines bottom-up, try `JSON.parse` on each line, take the first (bottom-most) that parses as a JSON object. Filter to entries where `typeof value === 'number'` and `isFinite(value)`. Return empty object if no valid JSON found.

4. Implement `aggregateMetrics(runs: Record<string, number>[]): Record<string, number>`. For each metric name present in any run, collect all values, sort numerically, take the median (middle value for odd count, average of two middle values for even). Skip empty runs. Return empty object if no valid runs.

5. Implement `computeCompositeScore(metrics: Record<string, number>, baseline: Record<string, number>, metricDefs: MetricDefinition[]): number`. For each MetricDefinition: calculate normalized improvement as `(current - baseline) / (|baseline| || 1)` for direction `max`, or `(baseline - current) / (|baseline| || 1)` for direction `min`. Multiply by weight. Sum weighted improvements and divide by total weight. Guard against zero total weight (return 0).

6. Implement `makeKeepDiscardDecision(current: Record<string, number>, baseline: Record<string, number> | null, metricDefs: MetricDefinition[]): KeepDiscardDecision`. If baseline is null (first experiment), return keep with reason "first experiment — establishes baseline". Otherwise compute composite score: if > 0, keep with per-metric comparison; if <= 0, discard with per-metric comparison showing regressions.

7. Implement `readBestMetrics(sliceDir: string): Record<string, number> | null` and `appendExperimentLog(sliceDir: string, result: ExperimentResult): void`. `readBestMetrics` reads EXPERIMENT-LOG.jsonl, parses each line (skip unparseable), finds the entry with `decision.decision === 'keep'` that has the highest experiment number (latest kept). Returns its metrics or null if no kept experiments. `appendExperimentLog` uses `appendFileSync` with `JSON.stringify(result) + '\n'`.

8. Implement `runExperimentPostProcess(opts: { sliceDir: string; basePath: string; experimentNumber: number; commitHash: string }): ExperimentResult`. Reads campaign config via `parseCampaignConfig`. Runs eval `config.evalConfig.runs` times (default 1), aggregates via median. Reads best metrics from log. Makes keep/discard decision. If discard, calls `revertExperiment`. Appends result to experiment log. Returns ExperimentResult. Handle edge cases: missing campaign config (discard with reason), all eval runs fail (discard), eval timeout (discard with "timed out" reason), no changes committed (handle gracefully).

## Must-Haves

- [ ] `runEval` distinguishes timeout (signal-based) from crash (non-zero exit) from success (exit 0)
- [ ] `parseMetrics` handles mixed stdout (progress bars, warnings interspersed with JSON) by scanning bottom-up
- [ ] `parseMetrics` filters to numeric-only values — non-numeric JSON fields are ignored
- [ ] `aggregateMetrics` computes median correctly for odd and even run counts
- [ ] `computeCompositeScore` normalizes weights at comparison time — config weights need not sum to 1.0
- [ ] `computeCompositeScore` handles direction (min vs max) correctly
- [ ] `computeCompositeScore` guards against division by zero when baseline metric is 0
- [ ] First experiment (null baseline) always kept if eval succeeds
- [ ] Discard calls `revertExperiment` with experiment ID and commit hash
- [ ] `appendExperimentLog` uses `appendFileSync` for crash safety
- [ ] `readBestMetrics` skips unparseable JSONL lines gracefully
- [ ] Contract tests cover all functions and edge cases listed above

## Verification

- `npm test -- eval-runner.test.ts` — all tests pass
- `npm run build` — exits 0 with no type errors
- Existing tests unaffected: `npm test -- research-types.test.ts git-experiment.test.ts` still pass

## Observability Impact

- Signals added: ExperimentResult.decision.reason provides human-readable explanation for every keep/discard
- How a future agent inspects this: `readBestMetrics(sliceDir)` for current best; grep EXPERIMENT-LOG.jsonl for decision history
- Failure state exposed: eval timeout vs crash vs missing config vs metric mismatch all produce distinct decision.reason strings

## Inputs

- `src/resources/extensions/gsd/types.ts` — ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig interfaces
- `src/resources/extensions/gsd/worktree.ts` — `revertExperiment(basePath, experimentId, commitHash, reason)`
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig(sliceDir)`, `countExperiments(sliceDir)`
- `src/resources/extensions/gsd/tests/research-types.test.ts` — test pattern to follow (custom assert/assertEq, temp dirs, process.exit(1) on failure)
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — integration test pattern with temp git repos

## Expected Output

- `src/resources/extensions/gsd/eval-runner.ts` — complete eval engine module with all pipeline functions exported
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — comprehensive contract tests (targeting 25+ assertions across all functions and edge cases)
