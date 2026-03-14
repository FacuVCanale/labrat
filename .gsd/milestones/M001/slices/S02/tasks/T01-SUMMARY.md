---
id: T01
parent: S02
milestone: M001
provides:
  - Research type interfaces (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext)
  - experimenting phase in Phase union
  - Campaign config detection in deriveState()
  - run-experiment unit type wired into all auto.ts switch sites
  - experiment phase classification in metrics
  - Experiment tracking fields in LockData
  - Research preferences section in GSDPreferences
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/metrics.ts
  - src/resources/extensions/gsd/crash-recovery.ts
  - src/resources/extensions/gsd/preferences.ts
  - src/resources/extensions/gsd/tests/research-types.test.ts
key_decisions:
  - Campaign config stored as CAMPAIGN.json in slice directory (co-located with plan)
  - Experiment log stored as EXPERIMENT-LOG.jsonl (append-only JSONL for crash safety)
  - Campaign detection short-circuits deriveState before blocker detection — active campaign takes priority
  - parseCampaignConfig does minimal shape validation and returns null for any malformed input (graceful degradation)
  - run-experiment artifact path points to EXPERIMENT-LOG.jsonl (existence check, not individual entries)
  - Experiment prompt is a minimal stub — real prompt building deferred to S04
patterns_established:
  - CAMPAIGN.json → experimenting phase transition pattern
  - EXPERIMENT-LOG.jsonl append-only experiment tracking
  - parseCampaignConfig/countExperiments as pure helper functions on state.ts
observability_surfaces:
  - classifyUnitPhase("run-experiment") returns "experiment" for per-experiment cost tracking in metrics ledger
  - deriveState() returns phase:"experimenting" with experiments progress (done/total) when campaign config present
  - LockData.experimentNumber and LockData.lastMetrics for crash recovery diagnostics
duration: 35m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Define research types and wire experimenting phase into state machine

**Added research type interfaces, `experimenting` phase, campaign config detection in deriveState(), and `run-experiment` unit routing across all auto.ts switch sites.**

## What Happened

Added 6 research type interfaces to types.ts: ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext. Added `experimenting` to the Phase union.

Added `parseCampaignConfig()` and `countExperiments()` helpers to state.ts. Wired campaign detection into `deriveState()` — when a valid CAMPAIGN.json exists in the active slice directory, state short-circuits to `experimenting` phase with experiment progress (done/total from JSONL log). Malformed or incomplete configs gracefully fall through to normal phase.

Wired `run-experiment` into all auto.ts switch statements: `describeNextUnit()`, `unitVerb()`, `unitPhaseLabel()`, `peekNext()`, `resolveExpectedArtifactPath()`, `ensurePreconditions()`, `diagnoseExpectedArtifact()`. Added `experimenting` phase dispatch in `dispatchNextUnit()` with a stub prompt (real prompt building is S04's scope).

Extended metrics.ts with `"experiment"` MetricsPhase and `run-experiment` → `"experiment"` classification. Extended LockData with optional `experimentNumber` and `lastMetrics` fields. Extended GSDPreferences with `research` section (eval timeout, max experiments, budget per experiment, metric directions). Added `run-experiment` to model resolution in preferences.ts.

Wrote 33 contract tests covering state derivation with/without campaign config, malformed config handling, type serialization round-trips, classifyUnitPhase, and helper edge cases.

## Verification

- `npm run build` — exits 0 with no errors
- `npm test -- research-types.test.ts` — 33/33 tests pass
- `grep -n 'Unexpected phase' auto.ts` — still at line 1327, `experimenting` handled at line 1284
- Existing tests pass: derive-state.test.ts, metrics.test.ts, parsers.test.ts, dispatch-guard.test.ts, doctor.test.ts

### Slice-level verification status (T01 of 2)
- ✅ `npm run build` passes with new Phase value handled everywhere
- ✅ `npm test -- --test-name-pattern "research|experiment|campaign"` — research-specific tests pass
- ✅ `research-types.test.ts` — all test cases pass (deriveState campaign detection, normal fallback, malformed config, classifyUnitPhase, type contracts)
- ⬜ `git-experiment.test.ts` — not yet created (T02 scope)
- ✅ Failure-path diagnostic: malformed CAMPAIGN.json returns normal phase, not crash

## Diagnostics

- `deriveState()` with a CAMPAIGN.json in the slice directory → check `state.phase === "experimenting"` and `state.progress.experiments`
- `classifyUnitPhase("run-experiment")` → should return `"experiment"`
- On crash, LockData at `.gsd/auto.lock` may contain `experimentNumber` and `lastMetrics` fields

## Deviations

- Added `experiments?: { done: number; total: number }` to the `progress` field in GSDState (not in original plan but natural extension for experiment progress tracking)
- Added `run-experiment` to model resolution in preferences.ts (maps to execution phase model config)
- Fixed widget display guard to also exclude `complete-milestone` from showing slice line (minor cleanup noticed during implementation)

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — Added `experimenting` to Phase union, added 6 research type interfaces
- `src/resources/extensions/gsd/state.ts` — Added parseCampaignConfig(), countExperiments(), campaign detection in deriveState()
- `src/resources/extensions/gsd/auto.ts` — Wired run-experiment into all switch sites, added experimenting phase dispatch
- `src/resources/extensions/gsd/metrics.ts` — Added "experiment" to MetricsPhase, run-experiment classification
- `src/resources/extensions/gsd/crash-recovery.ts` — Added experimentNumber and lastMetrics to LockData
- `src/resources/extensions/gsd/preferences.ts` — Added GSDResearchPreferences interface and research field to GSDPreferences, merge logic, model resolution for run-experiment
- `src/resources/extensions/gsd/tests/research-types.test.ts` — 33 contract tests for state derivation and type contracts
- `.gsd/milestones/M001/slices/S02/S02-PLAN.md` — Added failure-path diagnostic verification step
