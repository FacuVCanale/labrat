# S05: Learning Loop & State Flow

**Goal:** Verifier analysis feeds into next experiment's planner, state machine handles per-experiment plan→execute→verify cycling within a hypothesis, crash recovery works across the new flow, and existing campaigns continue working unchanged.
**Demo:** A NightShift campaign dispatches research-hypothesis once per hypothesis, then cycles plan-hypothesis→execute-hypothesis→verify-hypothesis per experiment. The verify agent writes EXPERIMENT-NNN-ANALYSIS.md, and the next experiment's plan prompt contains that analysis. Campaigns without `hypothesisMode` still dispatch `run-experiment` unchanged.

## Must-Haves

- Four new unit types: `research-hypothesis`, `plan-hypothesis`, `execute-hypothesis`, `verify-hypothesis`
- HYPOTHESIS-STATE.json per slice tracks current sub-phase and experiment number (atomic writes, crash-recoverable)
- `dispatchNextUnit` reads HYPOTHESIS-STATE.json and dispatches the correct unit type with the correct builder
- `handleAgentEnd` for `execute-hypothesis` runs eval post-processing and persists formatted results to EXPERIMENT-NNN-RESULTS.md
- `handleAgentEnd` for `verify-hypothesis` is lightweight (analysis file written by agent per prompt instruction)
- Plan prompt modification: instruct agent to write EXPERIMENT-NNN-PLAN.md to disk (execute builder reads it via D088)
- Backward compatibility: campaigns without `hypothesisMode: true` in CampaignConfig still use the existing `run-experiment` path
- All switch-site extensions: `unitVerb`, `unitPhaseLabel`, `peekNext`, `resolveExpectedArtifactPath`, `diagnoseExpectedArtifact`, `ensurePreconditions`, `SLICE_DISPATCH_TYPES`, `recoverTimedOutUnit`
- Lock file enrichment and crash recovery work for new unit types
- Budget guard runs after `execute-hypothesis` (where cost is incurred)

## Proof Level

- This slice proves: contract + integration
- Real runtime required: no (contract tests with mock filesystem prove dispatch sequence, state transitions, and backward compatibility)
- Human/UAT required: no (S06 validates runtime behavior end-to-end)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — state module: read/write/advance, atomic writes, corrupt recovery, phase sequencing
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — dispatch wiring: unit type selection, artifact paths, switch-site coverage, backward compat, results persistence format
- `npx tsc --noEmit` — compiles clean
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — existing 69 assertions still pass (plan prompt modification doesn't break template/builder parity)
- Failure-path check: `npx tsx -e "import {readHypothesisState} from './src/resources/extensions/gsd/hypothesis-state.js'; console.log(readHypothesisState('/nonexistent') === null ? 'PASS' : 'FAIL')"` — corrupt/missing state returns null with stderr warning

## Observability / Diagnostics

- Runtime signals: `[hypothesis] phase → research|plan|execute|verify` on stderr at each sub-phase transition, matching `[agenda]` pattern
- Inspection surfaces: `jq '.' HYPOTHESIS-STATE.json` in slice dir shows current sub-phase, experiment number, completed phases
- Failure visibility: corrupt HYPOTHESIS-STATE.json logs stderr warning and falls back to initial state (re-dispatch research); execute-hypothesis eval failure produces standard discard notification

## Integration Closure

- Upstream surfaces consumed: S04 builders (`buildResearchHypothesisPrompt`, `buildPlanExperimentPrompt`, `buildExecuteExperimentPrompt`, `buildVerifyExperimentPrompt`), `runExperimentPostProcess` from eval-runner.ts, `readAllExperiments`/`countExperiments` from eval-runner.ts, AGENDA-STATE.json atomic write pattern from agenda.ts
- New wiring introduced: `dispatchNextUnit` experimenting block routes to sub-phase dispatch for hypothesis-mode campaigns; `handleAgentEnd` has four new unit type handlers; new hypothesis-state.ts module
- What remains before the milestone is truly usable end-to-end: S06 (end-to-end integration with real eval, real git, real web search)

## Tasks

- [x] **T01: Wire hypothesis sub-phase dispatch and state machine** `est:45m`
  - Why: The core production code — introduces new unit types, HYPOTHESIS-STATE.json tracking, dispatch routing, handleAgentEnd processing, and all switch-site extensions. Without this, no hypothesis-driven dispatch exists.
  - Files: `src/resources/extensions/gsd/hypothesis-state.ts`, `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/dispatch-guard.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/nightshift-interview.ts`, `src/resources/extensions/gsd/prompts/plan-experiment.md`
  - Do: (1) Add `hypothesisMode?: boolean` to CampaignConfig in types.ts. (2) Create hypothesis-state.ts module with HypothesisState type, readHypothesisState/writeHypothesisState (atomic D045 pattern), advanceHypothesisPhase, formatResultsForVerify. Sub-phases: `research`, `plan`, `execute`, `verify`. (3) Modify plan-experiment.md to instruct writing EXPERIMENT-NNN-PLAN.md to disk (additive — existing content stays). (4) In auto.ts `dispatchNextUnit`: replace the `experimenting` block with hypothesis-mode detection (`config.hypothesisMode === true`) — if true, read HYPOTHESIS-STATE.json, dispatch appropriate sub-phase unit type using S04 builders; if false, fall through to existing `run-experiment` path. (5) In auto.ts `handleAgentEnd`: add cases for execute-hypothesis (run eval via runExperimentPostProcess, persist formatted results to EXPERIMENT-NNN-RESULTS.md, advance state to verify), plan-hypothesis (advance state to execute), verify-hypothesis (advance state to next experiment's plan or signal hypothesis complete), research-hypothesis (advance state to plan). (6) Extend all switch sites: unitVerb, unitPhaseLabel, peekNext, resolveExpectedArtifactPath, diagnoseExpectedArtifact, ensurePreconditions line 3028, recoverTimedOutUnit. (7) Add four new types to SLICE_DISPATCH_TYPES in dispatch-guard.ts. (8) Add `hypothesisMode: true` to CAMPAIGN.json in nightshift-interview.ts scaffold. (9) Lock enrichment: reuse existing experimentNumber pattern for execute-hypothesis. (10) Budget guard: copy existing per-experiment budget logic from run-experiment handler to execute-hypothesis handler.
  - Verify: `npx tsc --noEmit` compiles clean; `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — 69 assertions still pass
  - Done when: All new unit types dispatch correctly in hypothesis-mode, handleAgentEnd processes each type, eval results are persisted to EXPERIMENT-NNN-RESULTS.md for verify dispatch, and backward compat with non-hypothesis campaigns is preserved. TypeScript compiles clean.

- [x] **T02: Contract tests for hypothesis state flow and dispatch wiring** `est:35m`
  - Why: Proves the learning loop works: state transitions are correct, dispatch picks the right unit type per sub-phase, eval results flow from execute to verify, backward compat is preserved, and crash recovery handles new unit types. Without tests, the wiring is unverified.
  - Files: `src/resources/extensions/gsd/tests/hypothesis-state.test.ts`, `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts`
  - Do: (1) hypothesis-state.test.ts: test readHypothesisState returns null on missing file, returns null with stderr warning on corrupt JSON, round-trips through write/read, atomic write survives (tmp file removed on success), advanceHypothesisPhase transitions research→plan→execute→verify→plan(next)→..., experimentNumber increments on verify→plan transition, phase resets to research on initial state. (2) hypothesis-dispatch.test.ts: test resolveExpectedArtifactPath returns correct paths for all 4 new unit types (HYPOTHESIS-RESEARCH.md, EXPERIMENT-NNN-PLAN.md, EXPERIMENT-LOG.jsonl, EXPERIMENT-NNN-ANALYSIS.md), diagnoseExpectedArtifact returns non-null strings for all 4, unitVerb/unitPhaseLabel/peekNext return correct values for all 4, SLICE_DISPATCH_TYPES contains all 4, ensurePreconditions includes array has all 4, CampaignConfig with hypothesisMode: true parses correctly, CampaignConfig without hypothesisMode parses as before (backward compat), formatResultsForVerify produces readable markdown from ExperimentResult, plan-experiment.md template contains EXPERIMENT-NNN-PLAN.md write instruction, nightshift scaffold produces hypothesisMode: true in CAMPAIGN.json.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — all pass; `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — all pass
  - Done when: Both test files pass with 0 failures. Tests cover: state transitions (≥8 assertions), dispatch artifact paths (≥8 assertions), switch-site coverage (≥12 assertions), backward compatibility (≥4 assertions), results formatting (≥3 assertions). Total ≥35 assertions across both files.

## Files Likely Touched

- `src/resources/extensions/gsd/hypothesis-state.ts` (new — state module)
- `src/resources/extensions/gsd/auto.ts` (dispatch, handleAgentEnd, switch sites)
- `src/resources/extensions/gsd/dispatch-guard.ts` (SLICE_DISPATCH_TYPES)
- `src/resources/extensions/gsd/types.ts` (CampaignConfig.hypothesisMode)
- `src/resources/extensions/gsd/nightshift-interview.ts` (scaffold hypothesisMode)
- `src/resources/extensions/gsd/prompts/plan-experiment.md` (disk write instruction)
- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` (new)
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` (new)
