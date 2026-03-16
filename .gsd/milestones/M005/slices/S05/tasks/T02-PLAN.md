---
estimated_steps: 5
estimated_files: 2
---

# T02: Contract tests for hypothesis state flow and dispatch wiring

**Slice:** S05 — Learning Loop & State Flow
**Milestone:** M005

## Description

Prove the hypothesis-driven dispatch works correctly through contract tests. Two test files: one for the hypothesis-state module (state transitions, atomic I/O, corrupt recovery), one for dispatch wiring (artifact paths, switch-site coverage, backward compatibility, results formatting). Together they verify R047 (learning loop) and R048 (state flow) at contract level.

## Steps

1. **Create `hypothesis-state.test.ts`** testing the hypothesis-state.ts module:
   - readHypothesisState returns null on missing file
   - readHypothesisState returns null with stderr on corrupt JSON / invalid shape
   - writeHypothesisState + readHypothesisState round-trip
   - writeHypothesisState atomic: .tmp file doesn't persist after successful write
   - advanceHypothesisPhase: research→plan, plan→execute, execute→verify, verify→plan(experimentNumber+1)
   - Initial state has subPhase='research', experimentNumber=1
   - formatResultsForVerify produces markdown with metrics, decision, description, and id

2. **Create `hypothesis-dispatch.test.ts`** testing dispatch integration points:
   - resolveExpectedArtifactPath for research-hypothesis → HYPOTHESIS-RESEARCH.md
   - resolveExpectedArtifactPath for plan-hypothesis → EXPERIMENT-NNN-PLAN.md (with experiment number from unitId)
   - resolveExpectedArtifactPath for execute-hypothesis → EXPERIMENT-LOG.jsonl
   - resolveExpectedArtifactPath for verify-hypothesis → EXPERIMENT-NNN-ANALYSIS.md
   - diagnoseExpectedArtifact returns non-null for all 4 types
   - SLICE_DISPATCH_TYPES (imported from dispatch-guard) contains all 4 new types
   - CampaignConfig with hypothesisMode: true parses correctly via parseCampaignConfig
   - CampaignConfig without hypothesisMode parses as before (backward compat — hypothesisMode is undefined)
   - plan-experiment.md template contains EXPERIMENT-.*-PLAN.md write instruction
   - NightShift scaffold produces hypothesisMode: true in generated CAMPAIGN.json

3. **Verify existing tests still pass**: run hypothesis-prompt.test.ts to confirm the plan prompt modification didn't break template/builder parity.

4. **Check assertion counts**: verify ≥35 total assertions across both files (≥8 state, ≥8 artifact paths, ≥12 switch-sites, ≥4 backward compat, ≥3 formatting).

5. **Final compilation check**: `npx tsc --noEmit` to confirm test files compile alongside production code.

## Must-Haves

- [ ] hypothesis-state.test.ts passes with 0 failures
- [ ] hypothesis-dispatch.test.ts passes with 0 failures
- [ ] ≥35 total assertions across both files
- [ ] State transition sequence proven: research→plan→execute→verify→plan(next exp)
- [ ] Backward compatibility proven: non-hypothesis campaign config parses unchanged
- [ ] Existing hypothesis-prompt.test.ts (69 assertions) still passes
- [ ] formatResultsForVerify produces readable markdown with all key fields

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — 0 failures
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — 0 failures
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — 69 passed, 0 failed
- `npx tsc --noEmit` — clean

## Inputs

- `src/resources/extensions/gsd/hypothesis-state.ts` — module under test (from T01)
- `src/resources/extensions/gsd/auto.ts` — resolveExpectedArtifactPath, diagnoseExpectedArtifact exports (from T01)
- `src/resources/extensions/gsd/dispatch-guard.ts` — SLICE_DISPATCH_TYPES (from T01)
- `src/resources/extensions/gsd/types.ts` — CampaignConfig with hypothesisMode (from T01)
- `src/resources/extensions/gsd/nightshift-interview.ts` — scaffold generator (from T01)
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — existing test (from S04, must still pass)

## Expected Output

- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — new test file (~150 lines, ≥15 assertions)
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — new test file (~200 lines, ≥20 assertions)

## Observability Impact

- **Test output signals:** Each test file prints `<filename>: N passed, M failed` on stdout. Non-zero `failed` triggers exit code 1.
- **Hypothesis state stderr:** Tests exercise `advanceHypothesisPhase` which emits `[hypothesis] phase → <phase>` on stderr — confirms the diagnostic logging works end-to-end.
- **Corrupt-state warnings:** Tests for corrupt/invalid HYPOTHESIS-STATE.json trigger `[hypothesis] Corrupt HYPOTHESIS-STATE.json in <dir>` on stderr — proves the failure diagnostic surface is active.
- **Inspection:** Run any test file with `npx tsx` and observe stderr for phase transition and corruption warnings. Zero failures + expected stderr lines = healthy state module.
- **Failure state:** If hypothesis-state.ts changes break the contract, these tests surface it immediately with the specific assertion name that failed.
