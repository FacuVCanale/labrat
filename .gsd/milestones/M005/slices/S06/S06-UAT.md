# S06: End-to-End Integration — UAT

**Milestone:** M005
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S06 proves composition via deterministic integration tests — no LLM runtime needed. The tests exercise real subprocess eval, real git, real file I/O, and real state transitions. All observable artifacts (HYPOTHESIS-STATE.json, EXPERIMENT-LOG.jsonl, prompt output) are inspectable on disk.

## Preconditions

- Repository cloned and dependencies installed (`npm install`)
- Node.js 18+ with `npx tsx` available
- Python 3 available (for karpathy-smoke eval fixture)
- Git configured with user.name and user.email (tests init repos)

## Smoke Test

Run the integration test — if all 53 assertions pass, the assembled system composes correctly:

```bash
npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
```

Expected: `✓ 53 passed, ✗ 0 failed`

## Test Cases

### 1. Scaffold generates parser-compatible output

1. Run integration test and observe "Scaffold → Parser roundtrip" group
2. Verify `generateNightShiftScaffold` output parses through `parseRoadmapSlices` (2 slices extracted)
3. Verify each slice plan parses through `parsePlan` (3 tasks each)
4. Verify `parseCampaignConfig` returns valid config with `hypothesisMode: true`, `maxExperiments: 3`, and correct metric names/directions
5. **Expected:** All scaffold fields survive roundtrip through all three parsers without data loss

### 2. Prompt builders produce valid output with real data

1. Run integration test and observe "Prompt builders with real scaffold data" group
2. Verify `buildResearchHypothesisPrompt` returns non-empty string containing metric references from scaffold
3. Verify `buildPlanExperimentPrompt` returns non-empty string with metric references
4. Verify `buildExecuteExperimentPrompt` returns non-empty string with metric references
5. Verify `buildVerifyExperimentPrompt` returns non-empty string with metric references
6. Verify none of the four prompts contain `\bGSD\b` or `\blabrat\b` (after stripping file paths)
7. **Expected:** All four builders produce substantive prompts grounded in the scaffold data, with NightShift naming compliance

### 3. State machine cycles through full hypothesis

1. Run integration test and observe "State machine cycling" group
2. Verify initial state starts at `research` sub-phase, experiment 1
3. Verify `advanceHypothesisPhase` transitions: research→plan→execute→verify→plan(+1)→execute(+1)→verify(+1)→done
4. Verify experiment number increments from 1 to 2 on first verify→plan transition
5. Verify `advanceHypothesisPhase` returns `null` when maxExperiments (2) reached after final verify
6. Verify `completedPhases` accumulates all visited phases
7. **Expected:** State transitions fire in correct order with experiment numbers incrementing at verify→plan boundaries

### 4. Real eval executes against karpathy-smoke fixture

1. Run integration test and observe "Eval + JSONL" group
2. Verify `runEval` spawns real subprocess running karpathy-smoke's `python train.py`
3. Verify eval stdout contains valid JSON with metric values
4. Verify `appendExperimentLog` writes to JSONL and `countExperiments` returns incremented count
5. **Expected:** Real eval execution produces parseable metrics and JSONL stays synchronized

### 5. Full test suite regression

1. Run all five hypothesis test files:
   ```bash
   npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts
   npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts
   npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts
   npx tsx src/resources/extensions/gsd/tests/nightshift-interview.test.ts
   npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
   ```
2. **Expected:** 43 + 49 + 69 + 99 + 53 = 313 assertions, all pass, 0 failures

### 6. Clean compilation

1. Run `npx tsc --noEmit`
2. **Expected:** No type errors, clean exit

### 7. R049 validated in requirements

1. Run `grep "R049" .gsd/REQUIREMENTS.md | grep "validated"`
2. Run `grep "Active requirements:" .gsd/REQUIREMENTS.md`
3. **Expected:** R049 shows `validated` status; 0 active requirements remaining

## Edge Cases

### startAuto verboseMode parameter

1. Open `src/resources/extensions/gsd/nightshift-interview.ts` at line 365
2. Verify `startAuto` call includes explicit `false` as fourth argument
3. **Expected:** `startAuto(ctx, pi, basePath, false)` — prevents runtime TypeError from missing parameter

### Naming compliance with absolute paths

1. In the integration test, the eval command contains the repo's absolute path (e.g., `/home/.../labrat/examples/karpathy-smoke/...`)
2. The naming compliance check must strip file paths before grepping for `\blabrat\b`
3. **Expected:** No false positive from the directory name appearing in eval commands. The regex correctly ignores path-embedded occurrences.

### Multi-hypothesis transition

1. In the state machine cycling test, after H1 completes (maxExperiments reached), verify `deriveState` logic would select H2 as the next active hypothesis
2. **Expected:** Marking one hypothesis complete allows the state machine to move to the next hypothesis in the roadmap

## Failure Signals

- Any test assertion failure in the integration test — assertion name identifies the broken composition boundary
- `tsc --noEmit` producing type errors — indicates interface mismatch between components
- HYPOTHESIS-STATE.json phase field not advancing — state machine wiring issue
- EXPERIMENT-LOG.jsonl count mismatch with state — synchronization bug between eval runner and state tracker
- Prompt builders returning empty strings — template loading failure or builder parameter mismatch

## Requirements Proved By This UAT

- R049 — End-to-End Hypothesis Flow: This UAT exercises the complete assembly through deterministic tests proving scaffold→parser→builder→state→eval→JSONL→multi-hypothesis composition

## Not Proven By This UAT

- Runtime research depth (R046): Whether the LLM actually follows the multi-source research prompt instructions requires a live agent run, not a deterministic test
- Actual verifier analysis quality (R047): The test proves the format and persistence of analysis, not the quality of LLM-generated analysis
- Full autonomous `/nightshift auto` session: The test exercises components in isolation and composition, but not the full interactive→autonomous flow with a live LLM

## Notes for Tester

- The integration test creates temporary directories and git repos that are cleaned up automatically. If a test fails mid-run, tmpdir contents may remain for inspection.
- The karpathy-smoke fixture must have a working `train.py` that outputs JSON metrics to stdout. If Python is not installed or the fixture is broken, the eval tests will fail.
- State transition messages (`[hypothesis] phase →`) appear on stderr during tests — this is diagnostic output, not an error.
