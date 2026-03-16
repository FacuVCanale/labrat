---
estimated_steps: 6
estimated_files: 2
---

# T01: Integration test proving scaffold→dispatch→eval→state composition

**Slice:** S06 — End-to-End Integration
**Milestone:** M005

## Description

Write a deterministic integration test that proves the assembled hypothesis-driven flow composes correctly: scaffold generation → parser roundtrip → prompt builders with real data → state machine cycling → eval execution → JSONL synchronization → multi-hypothesis transitions. Also fix the startAuto 3-arg call in nightshift-interview.ts.

This is the R049 integration proof. It doesn't call `dispatchNextUnit` (needs full runtime context) — instead it composes the sub-components directly: generate scaffold, parse it, call builders, drive state transitions, run eval, check JSONL, advance hypotheses.

## Steps

1. Fix `startAuto(ctx, pi, basePath)` at line 365 of nightshift-interview.ts → `startAuto(ctx, pi, basePath, false)` to provide explicit verboseMode.

2. Create `hypothesis-integration.test.ts` with the standard test harness pattern (node:assert, custom test/assertInc wrappers, pass/fail counters, process.exit on failure).

3. **Scaffold→Parser roundtrip group:** Generate scaffold with `generateNightShiftScaffold` in a tmpdir. Parse roadmap via `parseRoadmapSlices`, parse each slice plan via `parsePlan`, parse CAMPAIGN.json via `parseCampaignConfig`. Assert: correct number of slices, hypothesisMode is true, metrics match input, maxExperiments matches input.

4. **Prompt builder group:** Call all four async builders (`buildResearchHypothesisPrompt`, `buildPlanExperimentPrompt`, `buildExecuteExperimentPrompt`, `buildVerifyExperimentPrompt`) with the real scaffold base path. Assert each returns a non-empty string. Assert research prompt contains tool names. Assert naming compliance (no \bGSD\b or \blabrat\b in any prompt output).

5. **State machine cycling group:** In a fresh tmpdir slice dir, create initial hypothesis state. Advance through research→plan→execute→verify. Assert sub-phase and experiment number at each step. Advance verify with maxExperiments > current to get plan+1 (experiment 2). Assert experimentNumber incremented. Advance verify with maxExperiments = current to get done (null return). Assert state completedPhases includes all phases.

6. **Eval + JSONL group:** Init a real git repo in tmpdir. Copy karpathy-smoke's train.py as the target file. Create CAMPAIGN.json with eval command pointing to karpathy-smoke's eval.py. Commit the target file. Run `runEval` with the karpathy-smoke eval command. Assert exit code 0 and stdout contains valid JSON metrics. Verify `countExperiments` matches expected count after JSONL append.

## Must-Haves

- [ ] startAuto call fixed with explicit `false` verboseMode
- [ ] Scaffold generates and roundtrips through all 3 parsers
- [ ] All 4 prompt builders produce non-empty prompts with real scaffold data
- [ ] State transitions fire in correct order with experiment number tracking
- [ ] Real eval runs against karpathy-smoke fixture
- [ ] Naming compliance: zero \bGSD\b or \blabrat\b in rendered prompts
- [ ] ≥30 total assertions

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — all pass, 0 fail
- `npx tsc --noEmit` — compiles clean
- Existing tests unbroken: `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` still passes 43

## Observability Impact

- Signals added/changed: none (test-only file)
- How a future agent inspects this: run the test file directly; assertion names describe what failed
- Failure state exposed: test name + assertion message on failure; tmpdir contents inspectable if cleanup disabled

## Inputs

- `src/resources/extensions/gsd/nightshift-interview.ts` — `generateNightShiftScaffold` function
- `src/resources/extensions/gsd/hypothesis-state.ts` — state machine functions
- `src/resources/extensions/gsd/auto.ts` — four prompt builder exports
- `src/resources/extensions/gsd/eval-runner.ts` — `runEval`, `runExperimentPostProcess`
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig`, `countExperiments`
- `examples/karpathy-smoke/eval.py` — deterministic eval fixture

## Expected Output

- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — new integration test file (~250-350 lines, ≥30 assertions)
- `src/resources/extensions/gsd/nightshift-interview.ts` — 1-line fix at line 365
