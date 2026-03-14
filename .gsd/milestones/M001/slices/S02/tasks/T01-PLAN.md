---
estimated_steps: 7
estimated_files: 8
---

# T01: Define research types and wire experimenting phase into state machine

**Slice:** S02 — Research Types & State Machine
**Milestone:** M001

## Description

Add all research-specific type definitions to `types.ts`, extend the Phase union with `experimenting`, wire the new phase and `run-experiment` unit type into every switch statement across the state machine, and add campaign config detection to `deriveState()`. This is the compile-level foundation — after this task, the codebase builds clean with full research flow awareness.

## Steps

1. **Add research types to `types.ts`** — New section at the bottom: `ExperimentResult` (id, description, metrics, decision, duration, cost, diff), `MetricDefinition` (name, direction, weight), `EvaluationConfig` (command, timeout, metrics, runs), `KeepDiscardDecision` (decision, reason, comparison), `CampaignConfig` (name, targetFiles, evalConfig, maxExperiments, budgetPerExperiment), `ExperimentContext` (experimentNumber, targetFileSource, bestMetrics, priorExperiments, researchQuestion). Add `'experimenting'` to the `Phase` union type.

2. **Add campaign config detection to `deriveState()` in `state.ts`** — After finding active slice and loading plan, check for campaign config file (`CAMPAIGN.json`) in the slice directory. If present and parseable, short-circuit to `experimenting` phase. Read experiment log (JSONL file) to determine experiment count for progress. Use existing `activeSlice` as context — campaigns run within slices. Add helper `parseCampaignConfig()` inline or import from files.ts.

3. **Wire `run-experiment` into auto.ts switch statements** — Add cases for:
   - `describeNextUnit()`: `"experimenting"` → label/description for experiment dispatch
   - `unitVerb()`: `"run-experiment"` → `"experimenting"`
   - `unitPhaseLabel()`: `"run-experiment"` → `"EXPERIMENT"`
   - `peekNext()`: `"run-experiment"` → `"next experiment"`
   - `resolveExpectedArtifactPath()`: `"run-experiment"` → experiment result JSON file path
   - `ensurePreconditions()`: `"run-experiment"` → ensure campaign branch exists (reuse ensureSliceBranch)
   - Add `"run-experiment"` to the `SLICE_DISPATCH_TYPES` set reference if needed, or handle in dispatch guard separately (T02)

4. **Add `experimenting` phase handling in the dispatch switch** — In `dispatchNextUnit()`, add `else if (state.phase === "experimenting")` case that sets `unitType = "run-experiment"` and builds a placeholder prompt (actual prompt building is S04's job — use a minimal stub that includes campaign config and experiment number).

5. **Extend supporting modules** — `metrics.ts`: add `"run-experiment"` → `"experiment"` to `classifyUnitPhase()`, add `"experiment"` to `MetricsPhase` union. `crash-recovery.ts`: add optional `experimentNumber?: number` and `lastMetrics?: Record<string, number>` to `LockData`. `preferences.ts`: add `research?: { default_eval_timeout?: number; max_experiments?: number; budget_per_experiment?: number; metric_directions?: Record<string, 'min' | 'max'> }` to `GSDPreferences`.

6. **Write contract tests in `tests/research-types.test.ts`** — Test `deriveState()` with a fixture that includes a campaign config file → assert phase is `"experimenting"`. Test without campaign config → assert normal phase. Test `classifyUnitPhase("run-experiment")` returns `"experiment"`. Test that CampaignConfig and ExperimentResult types can be constructed and serialized (compile-time contract). Test experiment progress is included in state.

7. **Build verification** — Run `npm run build`, verify no errors. Grep for uncovered switch sites.

## Must-Haves

- [ ] `experimenting` in Phase union type
- [ ] Research types exported: ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext
- [ ] `deriveState()` returns `experimenting` phase when campaign config exists in slice directory
- [ ] All auto.ts switch statements handle `run-experiment` / `experimenting` without falling to "Unexpected phase"
- [ ] `classifyUnitPhase("run-experiment")` returns `"experiment"`
- [ ] LockData extended with experiment tracking fields
- [ ] GSDPreferences extended with research config section
- [ ] Build passes clean
- [ ] Contract tests pass

## Verification

- `npm run build` exits 0 with no type errors
- `npm test -- --test-name-pattern "research|experiment|campaign"` — all new tests pass
- `grep -n 'Unexpected phase' src/resources/extensions/gsd/auto.ts` — the else clause still exists but `experimenting` is handled above it
- Existing tests still pass: `npm test` (full suite)

## Observability Impact

- Signals added/changed: `classifyUnitPhase` returns `"experiment"` for `"run-experiment"` unit type — enables per-experiment cost tracking in metrics ledger
- How a future agent inspects this: `deriveState()` returns `phase: "experimenting"` with experiment count in progress field; LockData on crash shows experiment number and last metrics
- Failure state exposed: Crash lock now includes experiment number and last metric values, enabling crash recovery to report which experiment was interrupted and what the last known metric state was

## Inputs

- `src/resources/extensions/gsd/types.ts` — existing type definitions to extend
- `src/resources/extensions/gsd/state.ts` — deriveState() to add campaign detection to
- `src/resources/extensions/gsd/auto.ts` — dispatch switches to add experiment cases to
- `src/resources/extensions/gsd/metrics.ts` — classifyUnitPhase to extend
- `src/resources/extensions/gsd/crash-recovery.ts` — LockData to extend
- `src/resources/extensions/gsd/preferences.ts` — GSDPreferences to extend
- `src/resources/extensions/gsd/tests/derive-state.test.ts` — pattern for test fixtures and assertions

## Expected Output

- `src/resources/extensions/gsd/types.ts` — extended with research types and `experimenting` phase
- `src/resources/extensions/gsd/state.ts` — campaign config detection in deriveState()
- `src/resources/extensions/gsd/auto.ts` — all switch statements handle experiment flow
- `src/resources/extensions/gsd/metrics.ts` — experiment phase classification
- `src/resources/extensions/gsd/crash-recovery.ts` — experiment fields in LockData
- `src/resources/extensions/gsd/preferences.ts` — research preferences section
- `src/resources/extensions/gsd/tests/research-types.test.ts` — contract tests for state derivation and type usage
