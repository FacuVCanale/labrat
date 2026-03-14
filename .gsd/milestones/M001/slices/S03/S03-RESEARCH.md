# S03: Eval Runner & Keep/Discard Engine — Research

**Date:** 2026-03-13

## Summary

S03 builds the mechanical core of the experiment loop: run a user's eval command, parse JSON metrics from stdout, compare against baseline with weighted composite scoring, and keep (commit) or discard (revert) based on results. This is entirely new code — no eval runner, metric parser, or comparison engine exists. The research types (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision) and git operations (commitExperiment/revertExperiment) from S02 are ready to consume.

The primary architectural question is where eval execution lives in the dispatch lifecycle. Two options: post-session processing in `handleAgentEnd` (auto.ts calls eval after the LLM finishes modifying files), or a registered tool the LLM calls during its session. Post-session processing is the recommended approach — it's more reliable (no prompt engineering for mechanical steps), cheaper (no LLM tokens for eval/parse/compare/decide), and fits naturally into the existing `handleAgentEnd` hook which already does auto-commit and post-processing. The LLM's job is creative (modify target files); eval/keep/discard is mechanical and should be programmatic.

The eval runner itself is straightforward: `spawnSync` with timeout, last-valid-JSON-line parsing from stdout, median aggregation for multi-run evals, weighted composite scoring across metrics, and a keep/discard decision function. The key complexity is in edge cases: eval crashes, timeouts, partial JSON, missing metrics, and the commit-before-eval / revert-on-discard lifecycle.

## Recommendation

**Post-session eval processing in `handleAgentEnd`.** Create an `eval-runner.ts` module with pure, testable functions for subprocess execution, metric parsing, composite scoring, and keep/discard decisions. Wire it into `handleAgentEnd` as a post-processing step for `run-experiment` units.

The flow becomes:
1. auto.ts dispatches `run-experiment` → LLM modifies target files → session ends
2. `handleAgentEnd` detects `run-experiment` unit type
3. Auto-commit already happens (existing code)
4. **New:** call `runExperimentPostProcess()` which: reads campaign config, runs eval command(s), parses metrics, compares against best, applies keep (leave commit) or discard (revert commit), appends to EXPERIMENT-LOG.jsonl
5. Dispatch next unit (existing flow)

This keeps the eval logic out of the LLM prompt, makes it deterministic and testable, and requires minimal changes to auto.ts (one new hook in handleAgentEnd, ~20 lines).

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Git commit/revert | `commitExperiment()` / `revertExperiment()` in `worktree.ts` | Already implemented in S02 with atomic commits, idempotent reverts, greppable messages |
| Campaign config reading | `parseCampaignConfig()` in `state.ts` | Already handles missing/malformed config gracefully |
| Experiment counting | `countExperiments()` in `state.ts` | Reads EXPERIMENT-LOG.jsonl line count |
| Subprocess execution pattern | `runGit()` in `git-service.ts` | Pattern for `execSync`/`spawnSync` with error handling — adapt for eval commands |
| Lock file experiment tracking | `LockData.experimentNumber` / `LockData.lastMetrics` in `crash-recovery.ts` | Fields exist, ready for S05 to consume |

## Existing Code and Patterns

- `src/resources/extensions/gsd/types.ts` (lines 190-237) — All research types ready: `MetricDefinition`, `EvaluationConfig`, `KeepDiscardDecision`, `ExperimentResult`, `CampaignConfig`. Import directly.
- `src/resources/extensions/gsd/worktree.ts` — `commitExperiment(basePath, id, desc)` returns commit hash, `revertExperiment(basePath, id, hash, reason)` produces clean reverts. Both are public exports.
- `src/resources/extensions/gsd/state.ts` (lines 60-96) — `parseCampaignConfig(sliceDir)` returns `CampaignConfig | null`, `countExperiments(sliceDir)` returns line count from EXPERIMENT-LOG.jsonl.
- `src/resources/extensions/gsd/auto.ts` (lines 528-582) — `handleAgentEnd()` is the post-session hook. Already does: auto-commit dirty files, run doctor, rebuild state. Natural insertion point for experiment post-processing.
- `src/resources/extensions/gsd/auto.ts` (lines 1284-1302) — Experiment dispatch with stub prompt. `currentUnit.type === "run-experiment"` is the detection condition.
- `src/resources/extensions/gsd/git-service.ts` (lines 159-172) — `runGit()` pattern: `execSync` with cwd, stdio config, error handling. Adapt for `spawnSync` eval execution.
- `src/resources/extensions/gsd/preferences.ts` (lines 75-80) — `GSDResearchPreferences` has `default_eval_timeout`, `max_experiments`, `budget_per_experiment`, `metric_directions`.
- `src/resources/extensions/gsd/crash-recovery.ts` — `LockData` has `experimentNumber` and `lastMetrics` fields for crash recovery (S05's responsibility, but we populate them).
- `src/resources/extensions/gsd/tests/research-types.test.ts` — 33 tests, uses Node built-in test runner with custom `assert()`/`assertEq()` helpers. Follow this pattern.
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — 14 tests, uses `execSync` to set up temp git repos. Follow this pattern for integration tests.

## Constraints

- **Node.js 22** — can use modern APIs (`spawnSync`, `structuredClone`, etc.)
- **Test framework** — Node's built-in `node --test` with custom assert helpers. No vitest/jest.
- **No async in eval runner core** — `spawnSync` is synchronous, metric parsing is synchronous, git operations are synchronous. Keep the eval module synchronous for simplicity and testability. Only the auto.ts hook needs async (it already is).
- **JSON to stdout** — eval output format is JSON objects on stdout (D005). Parser must handle mixed output (progress bars, warnings) by finding the last valid JSON line.
- **JSONL append-only** — EXPERIMENT-LOG.jsonl uses `appendFileSync` for crash safety (D013). Each line is one complete experiment result.
- **Commit-before-eval ordering** — The LLM modifies files, `handleAgentEnd` auto-commits, THEN eval runs. This means the eval tests the committed state. On discard, we revert the commit. On keep, the commit stays.
- **spawnSync over execSync for eval** — `spawnSync` gives clean `status`, `signal`, `stdout`, `stderr` separation. `execSync` conflates timeout kills with other failures.
- **Weight normalization** — MetricDefinition weights don't need to sum to 1.0 in config. Normalize at comparison time.

## Common Pitfalls

- **Eval stdout pollution** — Eval scripts commonly print progress bars, warnings, or logging alongside JSON metrics. The parser must not assume stdout is pure JSON. Strategy: scan lines bottom-up, take the last line that parses as a JSON object.
- **Timeout vs crash distinction** — A timed-out eval (signal=SIGTERM) is different from a crashed eval (non-zero exit). Both should result in discard, but with different reasons and different log entries. `spawnSync` provides `result.signal` for this.
- **Empty staging on commit** — `commitExperiment()` throws if nothing was staged. If the LLM didn't modify any tracked files, the experiment is a no-op. Catch this and log as "no changes produced" rather than crashing.
- **Metric name mismatch** — The eval script might produce metrics with names that don't match the CampaignConfig's MetricDefinition names. Must handle gracefully: warn about missing expected metrics, ignore unexpected extras.
- **Division by zero in composite scoring** — If all weights are 0, or if baseline metric is 0 for percentage improvement. Use absolute difference or guard the division.
- **Multi-run metric aggregation** — When `runs > 1`, run the eval N times and take the median. If any run crashes/timeouts, that run is excluded from the median. If all runs fail, the experiment is a discard.
- **Revert on baseline** — The first experiment has no baseline to compare against. Its metrics become the baseline. Decision: always keep the first experiment if eval succeeds (it establishes the baseline).
- **JSONL last-line truncation** — On crash, the last JSONL line may be truncated. `countExperiments()` already handles this (filters empty lines). The log reader must also handle it by trying to parse each line and skipping unparseable ones.

## Open Risks

- **handleAgentEnd modification scope** — Adding experiment post-processing to `handleAgentEnd` touches a critical path in auto.ts (~3000 lines, complex state). Must be surgical: detect `run-experiment` type early, call out to the eval module, avoid entangling with existing doctor/state-rebuild logic.
- **Eval command environment** — The eval command runs in a subprocess. It inherits the current process's environment. Users may need specific env vars (CUDA_VISIBLE_DEVICES, PYTHONPATH). Not clear if we need to support custom env — defer to S05/S07 if requested.
- **Non-numeric metrics** — What if the eval outputs `{"status": "pass"}` or `{"error": "OOM"}`? The type says `Record<string, number>` but real evals may include non-numeric fields. Parser should filter to numeric values only.
- **Composite score ties** — Two experiments with identical composite scores. Keep the newer one (it's already committed). Not a real risk in practice but the comparison function should handle equality cleanly.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Node.js child_process / subprocess | n/a | none found (core Node.js, no skill needed) |
| JSON parsing | n/a | none found (trivial, no skill needed) |

## Sources

- `spawnSync` timeout behavior verified empirically: returns `signal: 'SIGTERM'` and `status: null` on timeout (source: local Node.js 22 testing)
- `execSync` timeout behavior: `error.killed` is `undefined` (not `true`), making timeout detection unreliable (source: local testing)
- S02 forward intelligence: research types in `types.ts`, `parseCampaignConfig`/`countExperiments` in `state.ts`, `commitExperiment`/`revertExperiment` in `worktree.ts` (source: S02-SUMMARY.md)
- EXPERIMENT-LOG.jsonl append-only format per D013, commit message convention per D014 (source: DECISIONS.md)
- Node built-in test runner pattern from existing test files (source: research-types.test.ts, git-experiment.test.ts)
