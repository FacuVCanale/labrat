---
id: S02
parent: M001
milestone: M001
provides:
  - Research type interfaces (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext)
  - experimenting phase in Phase union with campaign config detection in deriveState()
  - run-experiment unit type wired into all auto.ts dispatch switch sites
  - Experiment tracking fields in LockData (experimentNumber, lastMetrics)
  - Research preferences section in GSDPreferences (eval timeout, max experiments, budget, metric directions)
  - commitExperiment() and revertExperiment() on GitServiceImpl with atomic commit/revert lifecycle
  - run-experiment in dispatch guard SLICE_DISPATCH_TYPES
  - Public experiment git wrappers in worktree.ts
requires:
  - slice: S01
    provides: Working GSD-2 codebase with build system, all existing infrastructure functional
affects:
  - S03 (eval runner consumes research types, git experiment ops)
  - S04 (research prompts consume ExperimentContext, state machine phase)
  - S05 (crash recovery uses LockData experiment fields)
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/metrics.ts
  - src/resources/extensions/gsd/crash-recovery.ts
  - src/resources/extensions/gsd/preferences.ts
  - src/resources/extensions/gsd/git-service.ts
  - src/resources/extensions/gsd/dispatch-guard.ts
  - src/resources/extensions/gsd/worktree.ts
  - src/resources/extensions/gsd/tests/research-types.test.ts
  - src/resources/extensions/gsd/tests/git-experiment.test.ts
key_decisions:
  - CAMPAIGN.json in slice directory triggers experimenting phase (D012)
  - EXPERIMENT-LOG.jsonl append-only for crash safety (D013)
  - experiment(E001)/revert(E001) commit message convention for git log discoverability (D014)
  - Campaign detection short-circuits deriveState before blocker detection (D016)
  - run-experiment added to SLICE_DISPATCH_TYPES — same sequential ordering as other slice work
  - commitExperiment throws on empty staging — no silent no-ops
  - revertExperiment uses git revert --no-commit + manual commit; idempotent via empty staging check
patterns_established:
  - CAMPAIGN.json → experimenting phase transition pattern
  - EXPERIMENT-LOG.jsonl append-only experiment tracking
  - parseCampaignConfig/countExperiments as pure helper functions on state.ts
  - experiment()/revert() commit message convention for greppable git history
  - Idempotent revert pattern — check staged diff, skip commit if empty
observability_surfaces:
  - classifyUnitPhase("run-experiment") returns "experiment" for per-experiment cost tracking
  - deriveState() returns phase:"experimenting" with experiments progress (done/total)
  - LockData.experimentNumber and LockData.lastMetrics for crash recovery diagnostics
  - Experiment commits discoverable via git log --oneline --grep="experiment(" on campaign branch
  - Revert commits discoverable via git log --oneline --grep="revert(" on campaign branch
drill_down_paths:
  - .gsd/milestones/M001/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T02-SUMMARY.md
duration: 50m
verification_result: passed
completed_at: 2026-03-13
---

# S02: Research Types & State Machine

**Dual-mode state machine with research flow semantics — experimenting phase, campaign config detection, experiment git lifecycle, and full dispatch routing for run-experiment units.**

## What Happened

**T01** added the research type foundation: 6 interfaces in types.ts (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext) and `experimenting` in the Phase union. State derivation gained `parseCampaignConfig()` and `countExperiments()` helpers — when a valid CAMPAIGN.json exists in the active slice directory, deriveState() short-circuits to `experimenting` phase with experiment progress. Malformed configs gracefully fall through to normal phase. `run-experiment` was wired into every auto.ts switch site: describeNextUnit, unitVerb, unitPhaseLabel, peekNext, resolveExpectedArtifactPath, ensurePreconditions, diagnoseExpectedArtifact, plus dispatching in dispatchNextUnit with a stub prompt (real prompt building deferred to S04). Metrics got `"experiment"` phase classification. LockData gained optional experimentNumber and lastMetrics fields. GSDPreferences gained a research section with eval timeout, max experiments, budget, and metric directions.

**T02** added `commitExperiment()` and `revertExperiment()` to GitServiceImpl. Commits use `experiment(E001): description` message format and throw on empty staging. Reverts use `git revert --no-commit` with custom commit messages and are idempotent (repeated calls on an already-reverted commit are silent no-ops). `run-experiment` was added to the dispatch guard's SLICE_DISPATCH_TYPES set for sequential ordering. Public wrappers exported from worktree.ts.

## Verification

- `npm run build` — exits 0, no errors
- `research-types.test.ts` — 33/33 tests pass (state derivation with/without campaign config, malformed config handling, type serialization, classifyUnitPhase, helper edge cases)
- `git-experiment.test.ts` — 14/14 tests pass (commit message format, hash return, empty commit error, revert message format, clean tree after revert, idempotent revert, tree hash match, dispatch guard)
- `dispatch-guard.test.ts` — existing tests pass
- `derive-state.test.ts` — existing tests pass
- `grep 'Unexpected phase' auto.ts` — experimenting handled before the exhaustive check

## Requirements Advanced

- R002 (Research Flow Semantics) — State machine now has dual-mode operation: experimenting phase alongside existing development flow, failed experiments advance with data, campaign config triggers research mode
- R006 (Git-Based Experiment State) — commitExperiment/revertExperiment provide atomic commit/revert lifecycle on campaign branches with greppable commit conventions

## Requirements Validated

- R002 (Research Flow Semantics) — deriveState returns experimenting phase when campaign config present, malformed config degrades gracefully, all switch sites handle the new phase, experiment failure is data (revert + continue) not a blocker. Contract-verified by 33 unit tests.
- R006 (Git-Based Experiment State) — commitExperiment produces labeled atomic commits, revertExperiment produces clean reverts, idempotent on repeated calls, tree hash matches pre-experiment state after revert. Contract-verified by 14 integration tests.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- Added `experiments?: { done: number; total: number }` to GSDState progress field — natural extension for experiment progress, not in original plan
- Added `run-experiment` to model resolution in preferences.ts — needed for model config lookup
- Fixed widget display guard to exclude `complete-milestone` from slice line — minor cleanup noticed during implementation

## Known Limitations

- Experiment dispatch contains a stub prompt — real prompt building deferred to S04
- No eval runner yet — run-experiment dispatches but cannot actually execute evaluations (S03)
- No crash recovery adaptation for experiments yet — LockData fields are present but not consumed (S05)
- Campaign branches not yet tested with real experiment flow — git operations verified in isolation

## Follow-ups

None — all known work is already mapped to downstream slices (S03–S07).

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — Added experimenting to Phase union, 6 research type interfaces
- `src/resources/extensions/gsd/state.ts` — Added parseCampaignConfig(), countExperiments(), campaign detection in deriveState()
- `src/resources/extensions/gsd/auto.ts` — Wired run-experiment into all switch sites, added experimenting phase dispatch
- `src/resources/extensions/gsd/metrics.ts` — Added "experiment" MetricsPhase, run-experiment classification
- `src/resources/extensions/gsd/crash-recovery.ts` — Added experimentNumber and lastMetrics to LockData
- `src/resources/extensions/gsd/preferences.ts` — Added GSDResearchPreferences, research section, merge logic, model resolution
- `src/resources/extensions/gsd/git-service.ts` — Added commitExperiment() and revertExperiment() methods
- `src/resources/extensions/gsd/dispatch-guard.ts` — Added run-experiment to SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/worktree.ts` — Added commitExperiment() and revertExperiment() public wrappers
- `src/resources/extensions/gsd/tests/research-types.test.ts` — 33 contract tests
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — 14 integration tests

## Forward Intelligence

### What the next slice should know
- Research types are in `types.ts` — import ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext directly
- `parseCampaignConfig(slicePath)` and `countExperiments(slicePath)` are exported from `state.ts` — use these to read campaign state
- `commitExperiment(basePath, experimentId, description)` and `revertExperiment(basePath, experimentId, commitHash, reason)` are exported from `worktree.ts`
- The experiment dispatch in auto.ts (line ~1284) has a stub prompt — S04 replaces this with real prompt building
- GSDPreferences.research contains eval config (timeout, maxExperiments, budgetPerExperiment, metricDirections)

### What's fragile
- The stub experiment prompt in auto.ts dispatching — it's a placeholder that produces minimal output, not suitable for real experiments
- parseCampaignConfig does minimal shape validation — if CampaignConfig interface changes, the validator needs updating

### Authoritative diagnostics
- `npm test -- research-types.test.ts` — 33 tests covering state derivation, type contracts, and edge cases
- `npm test -- git-experiment.test.ts` — 14 tests covering commit/revert lifecycle and dispatch guard
- `grep -n 'experimenting' src/resources/extensions/gsd/auto.ts` — shows all switch sites handling the new phase

### What assumptions changed
- Original plan didn't mention model resolution for run-experiment — added it to preferences.ts because auto.ts dispatching needs a model config
- GSDState progress type needed experiment count fields — extended the existing progress structure rather than adding a separate field
