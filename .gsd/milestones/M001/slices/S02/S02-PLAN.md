# S02: Research Types & State Machine

**Goal:** State machine recognizes research flow — phases are theories, failed experiments advance instead of blocking, campaign/phase/experiment hierarchy works with the existing Milestone/Slice/Task structure.
**Demo:** `deriveState()` returns `experimenting` phase when a campaign config exists, dispatch switch routes to `run-experiment` unit type, git service can commit/revert individual experiments on a campaign branch.

## Must-Haves

- `experimenting` phase in Phase union, handled in every switch site (auto.ts, metrics.ts, state.ts)
- Research types exported from types.ts: ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext
- `deriveState()` detects campaign config and returns `experimenting` phase with experiment count from log
- `run-experiment` unit type wired into auto.ts: unitVerb, unitPhaseLabel, peekNext, describeNextUnit, resolveExpectedArtifactPath, ensurePreconditions
- LockData extended with optional experiment tracking fields
- GSDPreferences extended with research-specific fields
- `commitExperiment()` and `revertExperiment()` in git-service.ts produce atomic, labeled commits
- Dispatch guard doesn't block experiment dispatch within a campaign
- `npm run build` passes with all changes

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `npm run build` — build passes with new Phase value handled everywhere
- `npm test -- --test-name-pattern "research|experiment|campaign"` — research-specific tests pass
- `src/resources/extensions/gsd/tests/research-types.test.ts` — unit tests for:
  - deriveState returns `experimenting` when campaign config present
  - deriveState returns normal phases when no campaign config
  - ExperimentResult, CampaignConfig type contracts compile and serialize correctly
  - classifyUnitPhase returns correct phase for `run-experiment`
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — unit tests for:
  - commitExperiment produces correctly labeled commit
  - revertExperiment produces clean revert commit
  - dispatch guard allows experiment dispatch
- Failure-path diagnostic: `deriveState()` with a malformed/unparseable CAMPAIGN.json in the slice directory returns normal phase (not crash) and LockData crash lock includes experiment number when present

## Observability / Diagnostics

- Runtime signals: `classifyUnitPhase("run-experiment")` returns `"experiment"` for metrics tracking
- Inspection surfaces: `deriveState()` returns `phase: "experimenting"` with experiment count in progress
- Failure visibility: LockData includes experiment number and last metric snapshot for crash diagnosis

## Integration Closure

- Upstream surfaces consumed: types.ts, state.ts, auto.ts, metrics.ts, crash-recovery.ts, git-service.ts, dispatch-guard.ts, preferences.ts (all from S01)
- New wiring introduced in this slice: `experimenting` phase in state derivation, `run-experiment` unit type routing in dispatch
- What remains before the milestone is truly usable end-to-end: eval runner (S03), research prompts (S04), experiment log (S05), MLOps integration (S06), CLI (S07)

## Tasks

- [x] **T01: Define research types and wire experimenting phase into state machine** `est:1h`
  - Why: Foundation for all research flow — types consumed by S03/S04, phase routing consumed by dispatch loop
  - Files: `types.ts`, `state.ts`, `auto.ts`, `metrics.ts`, `crash-recovery.ts`, `preferences.ts`, `tests/research-types.test.ts`
  - Do: Add research type interfaces to types.ts. Add `experimenting` to Phase union. Add campaign config detection to deriveState(). Wire `run-experiment` into all auto.ts switch statements (unitVerb, unitPhaseLabel, peekNext, describeNextUnit, resolveExpectedArtifactPath, ensurePreconditions). Add experiment fields to LockData. Add research prefs to GSDPreferences. Add `experiment` to classifyUnitPhase. Write contract tests proving state derivation and phase routing work.
  - Verify: `npm run build` passes, `npm test -- --test-name-pattern "research|experiment|campaign"` passes
  - Done when: Build clean, deriveState returns `experimenting` for campaign configs, all switch sites handle new phase/unit type

- [x] **T02: Add git experiment operations and dispatch guard adaptation** `est:45m`
  - Why: Experiments need atomic commit/revert on campaign branch, and dispatch guard must not block experiment dispatch
  - Files: `git-service.ts`, `dispatch-guard.ts`, `worktree.ts`, `tests/git-experiment.test.ts`
  - Do: Add `commitExperiment(experimentId, description)` and `revertExperiment(experimentId)` to GitServiceImpl. Add `run-experiment` to dispatch guard allowlist or bypass logic. Ensure campaign branches work with existing ensureSliceBranch. Write tests proving commit/revert produce correct git history and dispatch guard allows experiments.
  - Verify: `npm run build` passes, `npm test -- --test-name-pattern "git-experiment|dispatch"` passes
  - Done when: Git service can commit and revert experiments atomically, dispatch guard permits experiment dispatch, build clean

## Files Likely Touched

- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/state.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/metrics.ts`
- `src/resources/extensions/gsd/crash-recovery.ts`
- `src/resources/extensions/gsd/preferences.ts`
- `src/resources/extensions/gsd/git-service.ts`
- `src/resources/extensions/gsd/dispatch-guard.ts`
- `src/resources/extensions/gsd/worktree.ts`
- `src/resources/extensions/gsd/tests/research-types.test.ts`
- `src/resources/extensions/gsd/tests/git-experiment.test.ts`
