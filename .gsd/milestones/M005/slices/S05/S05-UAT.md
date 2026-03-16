# S05: Learning Loop & State Flow — UAT

**Milestone:** M005
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S05 is contract-verified infrastructure (state machine, dispatch routing, file I/O). All behavior is exercised through test files and TypeScript compilation. Runtime end-to-end validation with real eval/git/web search is S06's scope.

## Preconditions

- Repository checked out at the S05 branch or later
- Node.js available, `npm install` completed
- Working directory is the labrat project root

## Smoke Test

Run `npx tsc --noEmit` — compiles clean (exit 0, no output). This confirms all new types, imports, and switch-site extensions are wired correctly.

## Test Cases

### 1. Hypothesis state module: read/write/advance round-trip

1. Run `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts`
2. **Expected:** `43 passed, 0 failed` — covers read/write round-trip, atomic writes (.tmp removed), corrupt JSON recovery, invalid shape recovery, empty file recovery, phase transitions (research→plan→execute→verify→plan+increment), verify→done at max experiments, full cycle with completedPhases accumulation, bootstrap from missing state, formatResultsForVerify markdown output with all fields.

### 2. Dispatch wiring: unit types, artifact paths, switch-sites, backward compat

1. Run `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts`
2. **Expected:** `49 passed, 0 failed` — covers resolveExpectedArtifactPath for all 4 types (HYPOTHESIS-RESEARCH.md, EXPERIMENT-N-PLAN.md, EXPERIMENT-LOG.jsonl, EXPERIMENT-N-ANALYSIS.md), SLICE_DISPATCH_TYPES contains all 4, unitVerb/unitPhaseLabel/peekNext/diagnoseExpectedArtifact/ensurePreconditions/recoverTimedOutUnit wired for all 4, CampaignConfig with/without hypothesisMode, NightShift scaffold produces hypothesisMode: true, plan-experiment.md contains EXPERIMENT-NNN-PLAN.md write instruction, handleAgentEnd handles all 4 types, dispatch routing assigns all 4 unitType values.

### 3. Existing prompt tests unbroken

1. Run `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts`
2. **Expected:** `69 passed, 0 failed` — the plan-experiment.md modification (disk-write instruction) is additive; all original assertions still hold.

### 4. Failure-path: corrupt/missing state returns null

1. Run `npx tsx -e "import {readHypothesisState} from './src/resources/extensions/gsd/hypothesis-state.ts'; console.log(readHypothesisState('/nonexistent') === null ? 'PASS' : 'FAIL')"`
2. **Expected:** stdout prints `PASS`

### 5. TypeScript compilation

1. Run `npx tsc --noEmit`
2. **Expected:** Exit 0, no output. All new types (HypothesisState, hypothesisMode), imports (hypothesis-state.ts), and switch-site extensions compile clean.

### 6. Backward compatibility: non-hypothesis campaigns unaffected

1. Open `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts`
2. Find the `CampaignConfig without hypothesisMode parses as before` test
3. **Expected:** Test verifies that a CAMPAIGN.json without `hypothesisMode` field parses successfully with `hypothesisMode` as undefined — confirming M001/M002-era campaigns are unaffected.

### 7. Plan prompt contains disk-write instruction

1. Run `grep 'EXPERIMENT-{{experimentNumber}}-PLAN.md' src/resources/extensions/gsd/prompts/plan-experiment.md`
2. **Expected:** At least one line containing the EXPERIMENT-NNN-PLAN.md write instruction, confirming the plan agent is told to persist its plan to disk.

### 8. NightShift scaffold sets hypothesisMode

1. Run `grep 'hypothesisMode' src/resources/extensions/gsd/nightshift-interview.ts`
2. **Expected:** Line containing `hypothesisMode: true` in the scaffold generation code.

## Edge Cases

### Corrupt HYPOTHESIS-STATE.json with valid JSON but invalid shape

1. Create a temp file with `{"foo": "bar"}` (valid JSON, invalid HypothesisState)
2. Call `readHypothesisState` on its parent directory
3. **Expected:** Returns null, stderr shows `[hypothesis] Corrupt HYPOTHESIS-STATE.json in <dir> — invalid shape, returning null`

### advanceHypothesisPhase from missing state (bootstrap)

1. Call `advanceHypothesisPhase` on a directory with no HYPOTHESIS-STATE.json
2. **Expected:** Creates initial state (research, experiment 1) then advances to plan. Returns state with `subPhase: 'plan'`, `experimentNumber: 1`.

### verify→done when maxExperiments reached

1. Write a HYPOTHESIS-STATE.json with `subPhase: 'verify'`, `experimentNumber: 3`
2. Call `advanceHypothesisPhase(dir, 3)` with maxExperiments=3
3. **Expected:** Returns null (signals hypothesis complete — all experiments done).

### formatResultsForVerify with empty metrics

1. Call `formatResultsForVerify` with an ExperimentResult that has empty `parsedMetrics: {}`
2. **Expected:** Produces markdown with `**Metrics:** (none)` or similar — does not crash.

## Failure Signals

- Any test file reports `> 0 failed` — regression in state machine or dispatch wiring
- `npx tsc --noEmit` produces output — type error in new code or broken imports
- `hypothesis-prompt.test.ts` failures — plan-experiment.md modification broke existing template/builder parity
- `readHypothesisState('/nonexistent')` returns non-null — corrupt recovery broken
- grep for `hypothesisMode` in nightshift-interview.ts returns no results — scaffold won't set hypothesis mode

## Requirements Proved By This UAT

- R047 (Verifier Analysis & Learning Loop) — Test cases 1-2 prove: formatResultsForVerify produces structured markdown, verify-hypothesis artifacts map to EXPERIMENT-NNN-ANALYSIS.md, state advances verify→plan(next) with experiment increment for learning loop continuity.
- R048 (Hypothesis→Experiment State Flow) — Test cases 1-2 prove: full research→plan→execute→verify→plan(+1) cycle, dispatch routes to correct unit type per sub-phase, backward compatibility with non-hypothesis campaigns preserved, crash recovery via null-on-corrupt.

## Not Proven By This UAT

- Runtime behavior: agent actually writes EXPERIMENT-NNN-PLAN.md / EXPERIMENT-NNN-ANALYSIS.md (needs real LLM execution in S06)
- Eval integration: execute-hypothesis handler actually runs eval and persists results (needs real eval command in S06)
- Learning quality: verifier analysis is actually useful to the next experiment's planner (needs human/UAT judgment in S06)
- End-to-end flow: `/nightshift` → interview → `/nightshift auto` → full hypothesis cycle (S06 scope)

## Notes for Tester

- All test cases can be run non-interactively — no server, no LLM, no eval command needed.
- The 92 contract assertions are the primary verification. The edge cases section covers additional scenarios that are also covered by the test suites — they're listed for manual spot-checking if desired.
- The `[hypothesis] phase →` stderr messages during test runs are expected diagnostic output, not errors.
