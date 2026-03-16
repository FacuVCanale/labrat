---
id: S05
parent: M005
milestone: M005
provides:
  - hypothesis-state.ts module with HypothesisState type, atomic read/write, phase transitions, results formatting
  - Four hypothesis sub-phase unit types (research-hypothesis, plan-hypothesis, execute-hypothesis, verify-hypothesis) wired into dispatchNextUnit and handleAgentEnd
  - HYPOTHESIS-STATE.json per-slice tracking with crash-recoverable atomic writes
  - All 8 switch-site extensions for hypothesis unit types
  - Plan prompt disk-write instruction for EXPERIMENT-NNN-PLAN.md
  - Execute handler persists EXPERIMENT-NNN-RESULTS.md for verify dispatch
  - hypothesisMode flag on CampaignConfig and NightShift scaffold
  - 92 contract assertions across hypothesis-state and hypothesis-dispatch test files
requires:
  - slice: S04
    provides: Four prompt templates and builder functions (buildResearchHypothesisPrompt, buildPlanExperimentPrompt, buildExecuteExperimentPrompt, buildVerifyExperimentPrompt)
affects:
  - S06
key_files:
  - src/resources/extensions/gsd/hypothesis-state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/dispatch-guard.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/nightshift-interview.ts
  - src/resources/extensions/gsd/prompts/plan-experiment.md
  - src/resources/extensions/gsd/tests/hypothesis-state.test.ts
  - src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts
key_decisions:
  - D089: Hypothesis sub-phase dispatch via HYPOTHESIS-STATE.json, not deriveState changes
  - D090: hypothesisMode flag for backward-compatible dispatch routing
  - D091: Plan agent writes EXPERIMENT-NNN-PLAN.md to disk for inter-unit persistence
  - D092: Eval results persisted to EXPERIMENT-NNN-RESULTS.md between execute and verify
patterns_established:
  - Hypothesis state module follows agenda.ts pattern: atomic D045 writes, null-on-corrupt, stderr [hypothesis] warnings
  - Inter-unit data persistence via purpose-built markdown files (plan, results) read at dispatch time with placeholder fallback
  - Hypothesis sub-phase handlers in handleAgentEnd follow try/catch non-fatal pattern from run-experiment
observability_surfaces:
  - "[hypothesis] phase → research|plan|execute|verify" on stderr at each sub-phase transition
  - "[hypothesis] Corrupt HYPOTHESIS-STATE.json" on stderr when state file is invalid
  - "[hypothesis] Missing EXPERIMENT-NNN-PLAN.md" / "EXPERIMENT-NNN-RESULTS.md" on stderr at dispatch with placeholder fallback
  - HYPOTHESIS-STATE.json in slice dir inspectable via jq
  - EXPERIMENT-NNN-RESULTS.md persisted by execute-hypothesis handler for verify dispatch
drill_down_paths:
  - .gsd/milestones/M005/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S05/tasks/T02-SUMMARY.md
duration: 50m
verification_result: passed
completed_at: 2026-03-16
---

# S05: Learning Loop & State Flow

**Hypothesis sub-phase state machine with per-experiment plan→execute→verify cycling, inter-unit data persistence, crash-recoverable state tracking, and 92 contract assertions.**

## What Happened

Created the hypothesis state machine that enables per-experiment plan→execute→verify cycling within a hypothesis. The core is `hypothesis-state.ts` (~170 lines) — a new module following the established agenda.ts atomic-write pattern (D045). It provides `HypothesisState` type tracking sub-phase (research/plan/execute/verify) and experiment number, `readHypothesisState`/`writeHypothesisState` with atomic writes, `advanceHypothesisPhase` for state transitions (research→plan→execute→verify→plan+increment or done when max experiments reached), and `formatResultsForVerify` to convert ExperimentResult to readable markdown.

Modified `dispatchNextUnit` in auto.ts to check `config.hypothesisMode`: when true, reads HYPOTHESIS-STATE.json and dispatches the corresponding sub-phase unit type using S04 builders; when false/absent, existing `run-experiment` path is preserved unchanged (backward compat). The dispatch reads EXPERIMENT-NNN-PLAN.md at execute time and EXPERIMENT-NNN-RESULTS.md at verify time, with placeholder fallback and stderr warnings on missing files.

Added `handleAgentEnd` cases for all four new types: `execute-hypothesis` runs eval via `runExperimentPostProcess`, persists formatted results to EXPERIMENT-NNN-RESULTS.md, advances state to verify, runs budget guard and MLOps logging. `plan-hypothesis` and `research-hypothesis` are lightweight — just advance state. `verify-hypothesis` advances to next experiment's plan phase (incrementing experimentNumber) or returns null to signal hypothesis complete.

Extended all 8 switch sites (unitVerb, unitPhaseLabel, peekNext, resolveExpectedArtifactPath, diagnoseExpectedArtifact, ensurePreconditions, recoverTimedOutUnit, SLICE_DISPATCH_TYPES).

Added `hypothesisMode?: boolean` to CampaignConfig in types.ts and `hypothesisMode: true` to the NightShift scaffold in nightshift-interview.ts. Modified plan-experiment.md to instruct the agent to write EXPERIMENT-NNN-PLAN.md to disk (additive change, `sliceDir` template variable added to builder).

Built 92 contract assertions across two test files: hypothesis-state.test.ts (43 assertions covering read/write/advance/corrupt recovery/formatting) and hypothesis-dispatch.test.ts (49 assertions covering artifact paths, switch-site coverage, backward compat, dispatch routing, scaffold validation).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — **43 passed, 0 failed** ✅
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — **49 passed, 0 failed** ✅
- `npx tsc --noEmit` — **compiles clean** ✅
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — **69 passed, 0 failed** ✅ (existing tests unbroken)
- Failure-path: `readHypothesisState('/nonexistent') === null` — **PASS** ✅

## Requirements Advanced

- R047 (Verifier Analysis & Learning Loop) — verify-hypothesis handler advances state so next experiment's plan dispatch includes prior analysis via `readLatestExperimentAnalysis`. Results persisted to EXPERIMENT-NNN-RESULTS.md for verifier consumption. Analysis file written by agent per prompt instruction.
- R048 (Hypothesis→Experiment State Flow) — HYPOTHESIS-STATE.json tracks sub-phase and experiment number. Research dispatches once per hypothesis. Plan→execute→verify cycles per experiment with `advanceHypothesisPhase` managing transitions and experimentNumber incrementing on verify→plan.

## Requirements Validated

- R047 — Contract tests prove: formatResultsForVerify produces structured markdown from ExperimentResult (3 formatting assertions), advanceHypothesisPhase transitions verify→plan(next) with experiment number increment (state tests), resolveExpectedArtifactPath maps verify-hypothesis→EXPERIMENT-NNN-ANALYSIS.md (dispatch tests). Runtime validation of actual verifier output quality deferred to S06.
- R048 — Contract tests prove: full phase cycle research→plan→execute→verify→plan(+1) with completedPhases accumulation (8 state transition assertions), dispatch routes to correct sub-phase unit type (4 dispatch routing assertions), backward compat — campaigns without hypothesisMode use run-experiment unchanged (4 backward compat assertions), crash recovery via null-on-corrupt with stderr warning (5 corruption assertions).

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Added `sliceDir` template variable to `buildPlanExperimentPrompt` and the test fixture — the plan-experiment.md disk-write instruction requires `{{sliceDir}}` which wasn't in S04's original builder signature. Minor additive change.
- T01 created test files with real assertions (14+19) rather than empty skeletons — T02 expanded them to 43+49 rather than starting from scratch.
- Added `comparison: {}` to ExperimentResult test fixtures in T02 to match KeepDiscardDecision type (required field discovered at compile time, not anticipated in plan).

## Known Limitations

- Runtime verification of the learning loop (verifier actually writes useful analysis, plan agent actually uses it) is deferred to S06 end-to-end integration.
- No integration test with real eval command — state transitions and dispatch wiring are proven by contract tests only.
- HYPOTHESIS-STATE.json corrupt recovery resets to initial state (re-dispatches research), which may re-do completed research for a hypothesis.

## Follow-ups

- S06 must exercise the full flow with a real eval command to prove runtime behavior matches contract tests.

## Files Created/Modified

- `src/resources/extensions/gsd/hypothesis-state.ts` — New module: HypothesisState type, read/write/advance, formatResultsForVerify (~170 lines)
- `src/resources/extensions/gsd/auto.ts` — dispatchNextUnit hypothesis-mode block, 4 handleAgentEnd cases, 8 switch-site extensions (~180 lines added/modified)
- `src/resources/extensions/gsd/dispatch-guard.ts` — 4 new entries in SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/types.ts` — `hypothesisMode?: boolean` on CampaignConfig
- `src/resources/extensions/gsd/nightshift-interview.ts` — `hypothesisMode: true` in scaffold
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — Disk-write instruction for EXPERIMENT-NNN-PLAN.md (~4 lines added)
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — Added `sliceDir` to planExperimentVars fixture
- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — 43 assertions: state I/O, phase transitions, formatting
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — 49 assertions: artifact paths, switch-sites, backward compat, dispatch routing

## Forward Intelligence

### What the next slice should know
- All four hypothesis sub-phase unit types are wired and dispatch correctly. S06 needs to exercise the full flow: `/nightshift` → scaffold → `/nightshift auto` → research-hypothesis → plan-hypothesis → execute-hypothesis (eval runs) → verify-hypothesis → next experiment.
- The `sliceDir` variable was added to `buildPlanExperimentPrompt` in this slice — S06 must pass a real slice directory path when invoking the builder.
- Inter-unit persistence files (EXPERIMENT-NNN-PLAN.md, EXPERIMENT-NNN-RESULTS.md) are read at dispatch time with placeholder fallback — S06 should verify the plan agent actually writes the plan file and the execute handler actually writes the results file during a real run.

### What's fragile
- Missing EXPERIMENT-NNN-PLAN.md or EXPERIMENT-NNN-RESULTS.md at dispatch time degrades to placeholder text — the agent will run but may produce poor results without real context. S06 should verify these files are actually created.
- HYPOTHESIS-STATE.json corrupt recovery resets to research phase — acceptable for crash recovery but could waste a research-hypothesis dispatch if corruption happens late in a hypothesis.

### Authoritative diagnostics
- `jq '.' <sliceDir>/HYPOTHESIS-STATE.json` — shows current sub-phase, experiment number, completed phases. This is the ground truth for dispatch routing.
- stderr `[hypothesis] phase →` messages — confirm phase transitions are happening in the right order during a real run.
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` and `hypothesis-dispatch.test.ts` — 92 assertions covering all state transitions and dispatch wiring.

### What assumptions changed
- D088 assumed execute builder would receive plan text as a parameter passed from the prior unit's context. In practice, `handleAgentEnd` has no agent output text. D091 resolved this: plan agent writes to disk, execute dispatch reads from disk.
