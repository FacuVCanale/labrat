# S03: Eval Runner & Keep/Discard Engine

**Goal:** Run a user-defined eval command, parse JSON metrics from stdout, compare against baseline with weighted composite scoring, keep (commit) if improved or discard (revert) if not.
**Demo:** Contract tests prove the full eval pipeline: subprocess execution with timeout → metric parsing from mixed stdout → median aggregation across runs → weighted composite scoring → keep/discard decisions with correct git operations → JSONL experiment log append. The orchestrator is wired into handleAgentEnd so experiment post-processing runs automatically after the LLM modifies files.

## Must-Haves

- Eval command runs via `spawnSync` with configurable timeout (seconds), returns stdout/stderr/status/signal
- Parse JSON metrics from last valid JSON line in stdout (handles mixed output, progress bars, warnings)
- Filter to numeric values only — non-numeric fields ignored
- Multi-run eval: run N times, take median per metric, exclude crashed/timed-out runs
- Weighted composite scoring across metrics with direction-aware normalization (min vs max)
- First experiment (no baseline) always kept if eval succeeds — establishes baseline
- Keep = leave auto-commit in place; Discard = revertExperiment to undo commit
- Append ExperimentResult to EXPERIMENT-LOG.jsonl per experiment (crash-safe appendFileSync)
- handleAgentEnd detects `run-experiment` unit type and calls eval post-processing
- Timeout and crash produce discard with distinct reasons

## Proof Level

- This slice proves: contract (pure functions) + integration (handleAgentEnd wiring)
- Real runtime required: no (eval subprocess tested with echo commands in tests, auto.ts wiring verified by build + existing test suite)
- Human/UAT required: no

## Verification

- `npm test -- eval-runner.test.ts` — all contract tests pass covering: metric parsing (clean, mixed output, no JSON, non-numeric filtering), median aggregation (odd/even counts, single value, all failures), composite scoring (single metric, weighted multi-metric, direction handling, zero baseline guard, weight normalization), keep/discard decisions (improvement, regression, first experiment, eval failure, timeout), experiment log append (valid JSONL, crash-safe), subprocess execution (success, timeout, crash, stderr capture)
- `npm run build` — exits 0 with no type errors
- Existing test suite passes (research-types, git-experiment, dispatch-guard, derive-state)

## Observability / Diagnostics

- Runtime signals: ExperimentResult includes decision reason, timing, and per-metric before/after comparison — greppable in EXPERIMENT-LOG.jsonl
- Inspection surfaces: `grep 'discard\|keep' EXPERIMENT-LOG.jsonl` for decision history; `git log --oneline --grep="revert("` for reverted experiments
- Failure visibility: eval timeout vs crash distinguished in decision.reason; missing/mismatched metrics warned in reason string
- Redaction constraints: none (no secrets in eval output)

## Integration Closure

- Upstream surfaces consumed: `parseCampaignConfig()` and `countExperiments()` from `state.ts`; `commitExperiment()` and `revertExperiment()` from `worktree.ts`; research types from `types.ts`
- New wiring introduced in this slice: `runExperimentPostProcess()` call in `handleAgentEnd` for `run-experiment` units
- What remains before the milestone is truly usable end-to-end: research prompts (S04), crash recovery (S05), MLOps logging (S06), CLI + smoke test (S07)

## Tasks

- [x] **T01: Build eval engine module with contract tests** `est:45m`
  - Why: The entire eval pipeline (subprocess, parsing, scoring, decisions, logging) is new code. Pure functions with comprehensive tests establish the contract that all downstream slices consume.
  - Files: `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/tests/eval-runner.test.ts`
  - Do: Create `eval-runner.ts` with: `runEval(command, timeoutSecs, cwd)` using spawnSync; `parseMetrics(stdout)` scanning bottom-up for last valid JSON line, filtering to numeric values; `aggregateMetrics(results[])` taking median per metric; `computeCompositeScore(metrics, baseline, metricDefs)` with direction-aware weighted scoring and weight normalization; `makeKeepDiscardDecision(current, baseline, config)` handling first-experiment, improvement, and regression cases; `appendExperimentLog(sliceDir, result)` with appendFileSync; `readBestMetrics(sliceDir)` scanning EXPERIMENT-LOG.jsonl for best composite score; `runExperimentPostProcess(opts)` orchestrating the full pipeline including revertExperiment on discard. Write `eval-runner.test.ts` following existing test patterns (custom assert/assertEq helpers, temp dirs, process.exit on failure).
  - Verify: `npm test -- eval-runner.test.ts` passes, `npm run build` exits 0
  - Done when: All eval pipeline functions have contract tests, build compiles clean, no regressions in existing tests

- [x] **T02: Wire eval post-processing into handleAgentEnd** `est:20m`
  - Why: The eval engine exists but isn't called. handleAgentEnd needs to detect run-experiment units and invoke the orchestrator after auto-commit.
  - Files: `src/resources/extensions/gsd/auto.ts`
  - Do: In handleAgentEnd, after the auto-commit block and before doctor/state-rebuild, add a guard for `currentUnit.type === "run-experiment"`. Get the HEAD commit hash via `git rev-parse HEAD`. Call `runExperimentPostProcess()` with sliceDir derived from currentUnit.id, basePath, experiment number from countExperiments+1, and the commit hash. Wrap in try/catch — eval failure is non-fatal to the dispatch loop (experiment is discarded, loop continues). Notify UI with keep/discard result. Re-commit after state rebuild if revert happened.
  - Verify: `npm run build` exits 0, existing auto.ts-related tests pass, grep confirms the hook is correctly placed
  - Done when: handleAgentEnd calls runExperimentPostProcess for run-experiment units, build compiles, existing tests pass

## Files Likely Touched

- `src/resources/extensions/gsd/eval-runner.ts` (new)
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` (new)
- `src/resources/extensions/gsd/auto.ts` (modified — handleAgentEnd hook)
