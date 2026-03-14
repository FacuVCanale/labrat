# S02: Research Types & State Machine — Research

**Date:** 2026-03-13

## Summary

The GSD-2 state machine in `auto.ts` / `state.ts` is built around a linear, success-gated pipeline: research → plan → execute tasks → complete → advance. Failed tasks trigger replanning or blocking. Labrat's research loop needs the opposite: a circular, data-driven loop where experiments always advance the campaign — kept or discarded — and the next experiment is dispatched immediately with updated context.

The good news is that the infrastructure is more modular than expected. The dispatch loop in `auto.ts` routes on `state.phase` and `unitType` strings — it's fundamentally a switch statement, not a hardcoded pipeline. Adding new unit types ("run-experiment") and a new phase ("experimenting") is mechanical. The hard part is the state derivation in `state.ts`, which currently assumes a Plan file with checkboxes determines task progress. Research experiments don't have pre-planned tasks with checkboxes — they're generated on the fly.

The recommended approach is a **parallel mode, not a replacement**: add research-specific types, a new `experimenting` phase, and an `experiment-loop` unit type alongside the existing development flow. The existing GSD-2 flow stays intact (useful for planning-heavy research setup), and the research loop branches off when a slice/phase enters experiment mode. This preserves all existing infrastructure while adding the research semantics.

## Recommendation

### Approach: Dual-mode State Machine with Research Types Layer

1. **New types in `types.ts`**: Add research-specific interfaces (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext) as a separate section. These are consumed by S03 (eval runner) and S04 (prompts). Don't modify existing GSD types — extend alongside them.

2. **New phase `experimenting`**: Add to the `Phase` union type. `deriveState()` returns this phase when a campaign is configured and experiments are running. Triggered by a campaign config file (e.g., `CAMPAIGN.md` or `CAMPAIGN.json`) in the milestone or slice directory.

3. **State derivation adaptation**: Instead of looking for a plan with checkboxes, detect campaign config → derive experiment count from experiment log → determine if more experiments should run (budget, max-experiments, manual stop). The "active task" equivalent becomes the next experiment number.

4. **Dispatch addition in `auto.ts`**: Add `experimenting` case in the dispatch switch that dispatches a `run-experiment` unit type. After each experiment completes (agent_end), the loop re-derives state and dispatches the next experiment — identical to the existing task loop, but without pre-planned tasks.

5. **Git strategy adaptation**: Campaign uses a single branch (not branch-per-experiment). Each experiment starts with a commit of the modification, then eval runs. On keep: commit stays. On discard: `git revert` removes it. The branch accumulates kept improvements.

### What NOT to do

- Don't try to shoehorn experiments into the Task abstraction. Tasks have plans, estimates, verification steps, and checkboxes. Experiments have hypotheses, code modifications, and metric results. They're fundamentally different units.
- Don't remove or modify existing Phase values. Add `experimenting` as a new option.
- Don't change the development flow dispatch paths. Keep them intact.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Branch management | `GitServiceImpl` in `git-service.ts` | Already handles branch create/checkout/merge/auto-commit. Add experiment-specific commit/revert methods. |
| State derivation from disk | `deriveState()` in `state.ts` | Source of truth pattern. Extend with campaign config detection, not replace. |
| Fresh session per unit | `cmdCtx.newSession()` pattern in `auto.ts` | Each experiment needs a clean LLM context — this is already how it works. |
| Unit metrics tracking | `snapshotUnitMetrics()` in `metrics.ts` | Per-experiment cost/token tracking comes free by using the existing pattern. |
| Crash recovery lock | `writeLock()` / `readCrashLock()` in `crash-recovery.ts` | Extend LockData with experiment-specific fields (experiment number, last metric values). |
| Timeout supervision | `unitTimeoutHandle` / `idleWatchdogHandle` in `auto.ts` | Already per-unit. Experiment timeouts are just unit timeouts. |
| Prompt template loading | `loadPrompt()` in `prompt-loader.ts` | Same `{{variable}}` substitution pattern for experiment prompts. |
| Budget ceiling | `budgetCeiling` check in `dispatchNextUnit` | Already runs before each unit dispatch — experiments get budget protection for free. |

## Existing Code and Patterns

- `types.ts` (187 lines) — Pure type definitions. Research types go here as a new section at the bottom. No imports to update — consumers import what they need.
- `state.ts` (460 lines) — `deriveState()` is the single source of truth. Returns `GSDState` with `phase` field. Add campaign config detection early in the function: if campaign config file exists and experiments are running, short-circuit to `experimenting` phase.
- `auto.ts` (2960 lines) — Dispatch switch at lines 1133-1301 routes on `state.phase`. Add `experimenting` case at line ~1276 (after `executing`). Also need: `buildRunExperimentPrompt()`, `resolveExpectedArtifactPath()` case for experiments, `ensurePreconditions()` case for experiment branch.
- `auto.ts` line 528 `handleAgentEnd()` — Re-derives state and calls `dispatchNextUnit()`. No changes needed here — the loop is already phase-driven.
- `crash-recovery.ts` (85 lines) — `LockData` interface needs optional experiment fields. The write/read/clear pattern stays identical.
- `git-service.ts` (770 lines) — `autoCommit()` and branch management. Need `commitExperiment()` and `revertExperiment()` methods that produce atomic, labeled commits.
- `worktree.ts` (203 lines) — `ensureSliceBranch()` creates branch-per-slice. For campaigns, this maps to branch-per-campaign. Possibly rename the branch convention or add a parallel `ensureCampaignBranch()`.
- `files.ts` (824 lines) — Parsers for markdown artifacts. Need a `parseCampaignConfig()` function for the campaign config file. Experiment logs are JSON, not markdown — new parser in a new module.
- `doctor.ts` — Auto-fixes checkboxes in plans. Experiments don't have checkboxes, so doctor needs a "skip if experimenting" guard.
- `dispatch-guard.ts` (65 lines) — Guards against out-of-order slice dispatch. Research campaigns may need a different guard or no guard (experiments are inherently unordered).
- `preferences.ts` — `GSDPreferences` interface. Add research-specific preferences (default eval timeout, max experiments, budget per experiment, metric direction defaults).
- `metrics.ts` — `classifyUnitPhase()` returns phase labels for metrics display. Add `"experiment"` phase classification for `"run-experiment"` unit type.

## Constraints

- **Phase type is a string union** — adding a new phase value requires updating the `Phase` type in `types.ts` and handling it everywhere `switch(state.phase)` appears (at minimum: `state.ts`, `auto.ts`, `describeNextUnit()`, `unitPhaseLabel()`, `unitVerb()`, `peekNext()`).
- **`deriveState()` returns a single active task** — research needs to replace this with "next experiment number" semantics. The `ActiveRef` for `activeTask` could be reused (id: "E001", title: "Experiment 1") or a new field added.
- **`verifyExpectedArtifact()` determines unit completion** — experiments need a verifiable artifact. The experiment result file (JSON with metrics, decision, diff) serves this role.
- **`ensurePreconditions()` creates directories and branches** — must handle the campaign branch case.
- **The build must keep compiling** — all existing type consumers must handle the new phase value (even if just a default case).
- **Branch names use `gsd/M001/S01` pattern** — campaign branches could follow `labrat/campaign-name` or reuse the existing pattern. Since campaigns map to milestones (D002), `gsd/M001/S01` works if we keep the hierarchy mapping.
- **Prompt templates are `.md` files** — the experiment prompt template needs to include target file source, experiment history, and metric context. This is S04's job, but S02 must define the template variables (ExperimentContext type).
- **`handleAgentEnd()` calls `dispatchNextUnit()` unconditionally** — the loop already cycles automatically. Research flow gets this for free.
- **Dispatch guard (`dispatch-guard.ts`) enforces sequential slice completion** — campaigns need this relaxed or adapted. If experiments are all within one slice, the guard doesn't trigger.

## Common Pitfalls

- **Modifying the Phase union without updating all switch sites** — TypeScript won't warn about non-exhaustive switches on string unions by default. Grep for `switch (state.phase)` and `case "executing"` to find all sites.
- **Assuming experiments need pre-planned tasks** — The checkbox-based progress tracking in `deriveState()` assumes a plan file exists. Research needs a different progress signal: experiment count from log, or campaign config max_experiments.
- **Breaking the idempotency of `verifyExpectedArtifact()`** — Each unit must produce a verifiable file. If the experiment result file format is wrong, the dispatch loop will retry forever (MAX_UNIT_DISPATCHES = 3 then stop).
- **Conflating campaign branch with slice branch** — Campaigns run on a persistent branch where improvements accumulate. Slice branches are throwaway (squash-merged then deleted). The campaign branch must NOT be squash-merged — that loses experiment history.
- **Over-engineering experiment state** — The experiment log is the source of truth, not state derivation. `deriveState()` should read the log to determine experiment count, not parse N individual experiment files.

## Open Risks

- **Hierarchy mapping friction (D002)** — Campaign=Milestone, Phase=Slice, Experiment=Task was decided early. But experiments don't fit the Task mold well (no plan, no checkboxes, no summary in the same format). The mapping may need to be conceptual rather than literal — research uses the same directory structure but different file conventions.
- **Experiment numbering and concurrency** — If the experiment log is append-only JSON, we need atomic writes. Node.js `appendFileSync` is atomic for small writes on local filesystems, but the log needs to be parseable even if the last write was truncated (crash mid-write). JSONL (one JSON object per line) is safer than a single JSON array.
- **State derivation complexity** — Adding campaign config detection to `deriveState()` creates a branch: if campaign config exists → experimenting phase; else → existing development phase. This branch must be clean — the function is already 460 lines with complex logic.
- **Experiment prompt design (deferred to S04)** — S02 defines ExperimentContext (what the LLM receives). If the type is wrong, S04 will need to rework it. Keep the type minimal and extensible.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript state machine | state-machine-design | not relevant (codebase-specific state machine, not a framework) |

## Sources

- `auto.ts` dispatch logic (lines 1129-1301) — switch on `state.phase`, routes to unit type and prompt builder
- `state.ts` deriveState() (lines 98-460) — disk-based state derivation, source of truth for phase and active unit
- `types.ts` Phase union (line 8) — 13 existing phase values, adding `experimenting` is mechanical
- `git-service.ts` GitServiceImpl — branch/commit/merge operations, reusable with experiment-specific methods
- `crash-recovery.ts` LockData — minimal extension needed for experiment tracking
- `dispatch-guard.ts` — sequential guard that may conflict with research flow
