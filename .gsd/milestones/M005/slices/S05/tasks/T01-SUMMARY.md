---
id: T01
parent: S05
milestone: M005
provides:
  - HypothesisState type and atomic state I/O module (read/write/advance/format)
  - Four hypothesis sub-phase unit types wired into dispatchNextUnit and handleAgentEnd
  - All 8 switch-site extensions for hypothesis unit types
  - Plan prompt disk-write instruction for EXPERIMENT-NNN-PLAN.md
  - hypothesisMode flag on CampaignConfig and NightShift scaffold
  - Skeleton test files for hypothesis-state and hypothesis-dispatch
key_files:
  - src/resources/extensions/gsd/hypothesis-state.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/dispatch-guard.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/nightshift-interview.ts
  - src/resources/extensions/gsd/prompts/plan-experiment.md
key_decisions:
  - formatResultsForVerify converts ExperimentResult to markdown inline — no separate disk read needed by dispatch
  - advanceHypothesisPhase returns null when max experiments reached (signals hypothesis done)
  - execute-hypothesis reads plan from EXPERIMENT-NNN-PLAN.md on disk (plan agent writes it per prompt instruction, not D088 parameter passing)
  - verify-hypothesis reads results from EXPERIMENT-NNN-RESULTS.md on disk (execute handler writes it)
patterns_established:
  - Hypothesis state module follows agenda.ts pattern: atomic D045 writes, null-on-corrupt, stderr [hypothesis] warnings
  - Hypothesis sub-phase handlers in handleAgentEnd follow try/catch non-fatal pattern from run-experiment
  - Missing plan/results files at dispatch time degrade to placeholder strings with stderr warnings
observability_surfaces:
  - "[hypothesis] phase → research|plan|execute|verify" on stderr at each sub-phase transition
  - "[hypothesis] Corrupt HYPOTHESIS-STATE.json" on stderr when state file is invalid
  - "[hypothesis] Missing EXPERIMENT-NNN-PLAN.md" / "EXPERIMENT-NNN-RESULTS.md" on stderr at dispatch with placeholder fallback
  - HYPOTHESIS-STATE.json in slice dir inspectable via jq
  - EXPERIMENT-NNN-RESULTS.md persisted by execute-hypothesis handler for verify dispatch
duration: 35m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Wire hypothesis sub-phase dispatch and state machine

**Introduced four hypothesis sub-phase unit types with HYPOTHESIS-STATE.json tracking, dispatch routing, handleAgentEnd processing, all switch-site extensions, and skeleton contract tests.**

## What Happened

Created `hypothesis-state.ts` module (~170 lines) with `HypothesisState` type, atomic read/write following the agenda.ts D045 pattern, `advanceHypothesisPhase` for state transitions (research→plan→execute→verify→plan+increment or done), and `formatResultsForVerify` to convert ExperimentResult to readable markdown.

Modified `dispatchNextUnit` in auto.ts to check `config.hypothesisMode`: when true, reads HYPOTHESIS-STATE.json and dispatches the corresponding sub-phase unit type using S04 builders. When false/absent, existing `run-experiment` path is preserved unchanged. The dispatch reads EXPERIMENT-NNN-PLAN.md at execute time and EXPERIMENT-NNN-RESULTS.md at verify time, with placeholder fallback and stderr warnings on missing files.

Added `handleAgentEnd` cases for all four new types: `execute-hypothesis` runs eval, persists formatted results to EXPERIMENT-NNN-RESULTS.md, advances state to verify, runs budget guard and MLOps logging. `plan-hypothesis` and `research-hypothesis` are lightweight — just advance state. `verify-hypothesis` advances to next experiment's plan phase (incrementing experimentNumber) or returns null for hypothesis-complete.

Extended all 8 switch sites: unitVerb, unitPhaseLabel, peekNext, resolveExpectedArtifactPath, diagnoseExpectedArtifact, ensurePreconditions, recoverTimedOutUnit, and SLICE_DISPATCH_TYPES.

Added `hypothesisMode?: boolean` to CampaignConfig and `hypothesisMode: true` to the NightShift scaffold.

Modified plan-experiment.md to instruct the agent to persist the plan to EXPERIMENT-NNN-PLAN.md. Added `sliceDir` template variable to the builder call.

Created skeleton test files for T02: `hypothesis-state.test.ts` (14 assertions) and `hypothesis-dispatch.test.ts` (19 assertions).

## Verification

- `npx tsc --noEmit` — compiles clean ✅
- `npx tsx hypothesis-prompt.test.ts` — 69 passed, 0 failed ✅ (plan prompt modification is additive; added `sliceDir` var to test fixture)
- `npx tsx hypothesis-state.test.ts` — 14 passed, 0 failed ✅ (read/write/advance/round-trip/corrupt/format)
- `npx tsx hypothesis-dispatch.test.ts` — 19 passed, 0 failed ✅ (switch-site coverage, SLICE_DISPATCH_TYPES, handleAgentEnd handlers, import wiring)
- grep for all 4 unit type strings in auto.ts — 10/9/9/9 occurrences confirming full switch coverage ✅

## Diagnostics

- `jq '.' .gsd/milestones/M001/slices/S01/HYPOTHESIS-STATE.json` — shows current subPhase, experimentNumber, completedPhases
- Corrupt HYPOTHESIS-STATE.json → stderr `[hypothesis] Corrupt HYPOTHESIS-STATE.json in <dir>` + returns null (falls back to initial state at dispatch)
- Missing EXPERIMENT-NNN-PLAN.md at execute dispatch → stderr warning + placeholder text
- Missing EXPERIMENT-NNN-RESULTS.md at verify dispatch → stderr warning + placeholder text

## Deviations

- Added `sliceDir` template variable to `buildPlanExperimentPrompt` and the test fixture — the new disk-write instruction in plan-experiment.md requires `{{sliceDir}}` which wasn't previously passed. This is a minor additive change to the builder.
- Created test files with real assertions (14+19) rather than empty skeletons — T02 can add more assertions but the core contracts are already verified.

## Known Issues

- none

## Files Created/Modified

- `src/resources/extensions/gsd/hypothesis-state.ts` — New module: HypothesisState type, read/write/advance, formatResultsForVerify (~170 lines)
- `src/resources/extensions/gsd/auto.ts` — dispatchNextUnit hypothesis-mode block, 4 handleAgentEnd cases, 8 switch-site extensions, hypothesis-state import, sliceDir var in plan builder (~180 lines added/modified)
- `src/resources/extensions/gsd/dispatch-guard.ts` — 4 new entries in SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/types.ts` — `hypothesisMode?: boolean` on CampaignConfig
- `src/resources/extensions/gsd/nightshift-interview.ts` — `hypothesisMode: true` in scaffold
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — Disk-write instruction for EXPERIMENT-NNN-PLAN.md (~4 lines added)
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — Added `sliceDir` to planExperimentVars fixture
- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — New test file (14 assertions)
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — New test file (19 assertions)
- `.gsd/milestones/M005/slices/S05/S05-PLAN.md` — Added failure-path verification step
