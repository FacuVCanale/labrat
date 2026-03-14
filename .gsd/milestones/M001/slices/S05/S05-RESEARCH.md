# S05: Experiment Log, Crash Recovery & Supervision — Research

**Date:** 2026-03-13

## Summary

S05 delivers four requirements (R007, R008, R009, R010) that make the experiment loop production-grade — surviving crashes, respecting budgets, enforcing experiment limits, and producing a queryable log. The good news: most of the hard infrastructure exists from GSD-2 (lock file, crash recovery, budget ceiling, timeout supervision, metrics ledger). The work is adaptation and gap-filling, not greenfield.

The primary gaps are: (1) experiment-specific crash recovery — reverting uncommitted or committed-but-unevaluated experiments on restart, (2) enriching the lock file with experiment state during dispatch, (3) adding max-experiment and per-experiment budget guards to the dispatch loop, and (4) adding `timestamp` to `ExperimentResult` for queryable/sortable log entries. The existing infrastructure constrains the approach in helpful ways — the patterns are established, the file I/O is proven, and the test harness is in place.

The riskiest part is the crash recovery window between auto-commit (line 544 of auto.ts) and eval post-processing (line 560). If the process dies in that window, there's a committed experiment that was never evaluated and never logged. On restart, `countExperiments` reads JSONL lines (correct count), but git history has an orphan commit. Recovery must detect this state and either revert the orphan or run eval on it.

## Recommendation

Wire experiment state into the existing infrastructure rather than building parallel systems. Specifically:

1. **Crash recovery**: Enrich `writeLock` call with `experimentNumber` at dispatch time. On restart in `startAuto`, if the crash lock shows `unitType === 'run-experiment'`, check for orphan commits (committed but not in JSONL) and revert them before resuming. Use `countExperiments` vs git log to detect the gap.

2. **Max experiment guard**: Add a check in `dispatchNextUnit` before the `experimenting` phase block — if `experimentsDone >= maxExperiments`, transition to summarizing phase (or pause). This is a 5-line guard, not a state machine change.

3. **Budget guards**: Per-experiment budget uses the existing metrics ledger — after each experiment unit completes, check the unit's cost against `budgetPerExperiment`. Campaign-level budget uses the existing `budget_ceiling` check, which already runs in `dispatchNextUnit`. Both are guard additions to existing checks.

4. **Timeout supervision**: The existing soft/idle/hard timeout system already applies to `run-experiment` units. The experiment-specific adaptation is handling `run-experiment` in `recoverTimedOutUnit` — check if the experiment artifact (JSONL entry) was written, revert if not.

5. **Experiment log enrichment**: Add `timestamp` field to `ExperimentResult` type. Populate it in `runExperimentPostProcess`. Existing JSONL I/O unchanged — `appendFileSync` is already crash-safe.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Lock file management | `crash-recovery.ts` — `writeLock`, `readCrashLock`, `clearLock` | Already proven, has experiment-specific fields (`experimentNumber`, `lastMetrics`) defined but unused |
| Budget ceiling | `auto.ts` line 1196-1209, `preferences.ts` `budget_ceiling` | Guard already pauses auto-mode, just needs experiment-awareness |
| Timeout supervision | `auto.ts` line 1598-1689, `resolveAutoSupervisorConfig()` | Soft/idle/hard timeouts already fire for all unit types including `run-experiment` |
| Metrics/cost tracking | `metrics.ts` — `snapshotUnitMetrics`, `getLedger`, `getProjectTotals` | Per-unit cost already captured, just needs per-experiment guard logic |
| Crash forensics | `session-forensics.ts` — `synthesizeCrashRecovery` | Rich recovery briefing from surviving session file already works |
| Unit runtime records | `unit-runtime.ts` — `writeUnitRuntimeRecord`, `readUnitRuntimeRecord` | Progress tracking, phase state, recovery attempts all established |
| Git revert | `git-service.ts` — `revertExperiment` | Idempotent revert with labeled commit messages, proven by S02 integration tests |
| JSONL log I/O | `eval-runner.ts` — `appendExperimentLog`, `readAllExperiments`, `readBestMetrics` | Crash-safe appendFileSync, skips corrupted lines, S03 contract tests |

## Existing Code and Patterns

- `crash-recovery.ts` (89 lines) — Lock file with `LockData` interface. `experimentNumber` and `lastMetrics` fields defined but never written during experiment dispatch. `writeLock` takes positional args (basePath, unitType, unitId, completedUnits, sessionFile) — no experiment fields passed. Needs a call-site update or overload.
- `auto.ts:1489` — `writeLock` call at dispatch time. Currently passes only the five positional args. This is where `experimentNumber` should be written for crash recovery.
- `auto.ts:412-435` — Crash recovery on startup reads lock, synthesizes recovery briefing, clears lock. No experiment-specific logic — doesn't check for orphan commits or revert incomplete experiments.
- `auto.ts:1308-1315` — Experiment dispatch in `dispatchNextUnit`. No max-experiment guard. No per-experiment budget check. Just derives experiment number and dispatches.
- `auto.ts:552-573` — Experiment post-processing in `handleAgentEnd`. The dangerous crash window: auto-commit happens at line 544, eval post-processing at line 560. If process dies between these, orphan commit exists.
- `auto.ts:1196-1209` — Budget ceiling guard. Checks `budget_ceiling` against total project cost. Pauses if exceeded. No per-campaign or per-experiment budget variant.
- `eval-runner.ts:431-553` — `runExperimentPostProcess` orchestrator. Constructs `ExperimentResult` without `timestamp`. Sets `cost: 0` (cost is tracked in metrics ledger, not in experiment result).
- `types.ts:213-221` — `ExperimentResult` interface. Missing `timestamp` field.
- `state.ts:410-436` — `deriveState` campaign detection. Returns `experimenting` phase regardless of whether `experimentsDone >= maxExperiments`. Needs a max-experiment completion check.
- `preferences.ts:75-80` — `GSDResearchPreferences` with `default_eval_timeout`, `max_experiments`, `budget_per_experiment`, `metric_directions`. These are defined but not consumed by any supervision logic.
- `auto.ts:2626-2700+` — `recoverTimedOutUnit` handles `execute-task` specifically but has no `run-experiment` case. Falls through to generic behavior.

## Constraints

- `writeLock` uses positional arguments — adding experiment fields requires either extending the signature or updating `LockData` after initial write. The lock file is JSON, so updating it is straightforward (read-modify-write).
- `ExperimentResult` is used across `eval-runner.ts`, `auto.ts`, `types.ts`, and prompt builders. Adding `timestamp` is additive (optional field) so it's backward-compatible with existing JSONL entries.
- `spawnSync` in `runEval` blocks the event loop — during eval execution, supervision timers (setTimeout/setInterval) cannot fire. This means idle detection can't work during eval runs. The eval's own `timeout` param (passed to spawnSync) is the only timeout that works here.
- `appendFileSync` is atomic at the OS level for reasonable sizes. JSONL crash safety depends on this — a truncated last line is the worst case, and `readAllExperiments` already skips unparseable lines.
- Budget ceiling check runs at the top of `dispatchNextUnit` (before dispatch), not after experiment completion. Per-experiment budget check would need to run in `handleAgentEnd` to catch the cost of the just-completed experiment.
- The `cost` field in `ExperimentResult` is always `0` — actual cost lives in the metrics ledger (`UnitMetrics.cost`). To populate experiment-level cost, we need to call `snapshotUnitMetrics` before `runExperimentPostProcess` and pass the cost in.

## Common Pitfalls

- **Orphan commit detection on restart** — Don't assume git history and JSONL are always in sync. The crash window between auto-commit and JSONL append is real. Detection: compare `countExperiments(sliceDir)` against the number of `experiment(E*)` commits in git log. If git has more, revert the last one.
- **Budget check timing** — Per-experiment budget must check *after* the unit completes (cost is known), not *before* dispatch (cost is projected). Campaign-level `budget_ceiling` already checks before dispatch, which is correct for total budget. These are complementary guards.
- **Max experiment guard placement** — Should be in `deriveState`, not just `dispatchNextUnit`. If `deriveState` returns `experimenting` when max is reached, the dispatch picks it up and runs another experiment. The guard belongs in state derivation: when `experimentsDone >= maxExperiments`, return `summarizing` phase instead of `experimenting`.
- **Lock file experiment state** — The `writeLock` call at dispatch time doesn't know the experiment number because it runs before `buildExperimentPrompt`. But `expNum` is computed at line 1312, before `writeLock` at 1489. So the fix is to capture `expNum` in the dispatch branch and pass it to `writeLock`.
- **D024 (Do NOT write STATE.md in completion units)** — Any state file writes in crash recovery or supervision must not interfere with auto-mode's STATE.md management. Stick to lock file and JSONL updates only.

## Open Risks

- **Eval blocks supervision timers** — Since `runEval` uses `spawnSync`, the Node.js event loop is blocked during eval execution. If an eval runs for 4 minutes and the idle timeout is 10 minutes, the idle watchdog won't fire during those 4 minutes (the timer callback queues but doesn't execute until after spawnSync returns). This is mostly harmless (eval has its own timeout), but the idle timer's "last progress" time will include the eval duration, potentially triggering a false idle detection right after eval completes. Mitigation: update `lastProgressAt` after eval completes in the post-processing hook.
- **Concurrent experiment revert race** — If crash recovery reverts an orphan commit while deriveState is reading campaign config, there's a theoretical race. In practice, crash recovery runs once at startup before any dispatch, so this shouldn't be an issue.
- **Cost accuracy for per-experiment budget** — `snapshotUnitMetrics` extracts cost from session entries, which depend on the LLM provider reporting usage. Some providers may not report cost, making the budget guard ineffective. The guard should degrade gracefully (skip check if cost is 0).

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Node.js crash recovery | n/a | none found — core infrastructure, no external skill needed |
| JSONL logging | n/a | none found — standard pattern |

## Sources

- Codebase exploration of `crash-recovery.ts`, `metrics.ts`, `auto.ts`, `eval-runner.ts`, `state.ts`, `preferences.ts`, `types.ts`, `unit-runtime.ts`, `session-forensics.ts`, `git-service.ts`
- S03 summary for eval pipeline architecture and integration points
- DECISIONS.md for D013 (JSONL format), D017 (artifact verification), D023 (eval hook placement), D024 (STATE.md constraint)
