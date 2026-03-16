# S06: End-to-End Integration

**Goal:** Prove the assembled hypothesis-driven flow works end-to-end: scaffold→parse→dispatch→eval→state-transitions→next-experiment→next-hypothesis.
**Demo:** A deterministic integration test drives the full state machine through scaffold generation, all three parser roundtrips, four prompt builders with real scaffold data, hypothesis state cycling (research→plan→execute→verify→plan+1), real eval execution with karpathy-smoke fixture, JSONL/state synchronization, and multi-hypothesis transitions — all without a live LLM.

## Must-Haves

- Integration test proves scaffold→parser→builder→state-transition→eval composition works
- State transitions fire in correct order: research→plan→execute→verify→plan(+1)→...
- Real eval runs against karpathy-smoke fixture producing valid JSONL entries
- JSONL experiment count stays in sync with HYPOTHESIS-STATE.json experiment number
- All four prompt builders produce non-empty prompts with real scaffold data
- Multi-hypothesis transition works (hypothesis 1 complete → hypothesis 2 active)
- startAuto 3-arg call fixed with explicit `false` for verboseMode
- R049 validated in REQUIREMENTS.md

## Proof Level

- This slice proves: final-assembly
- Real runtime required: yes (eval subprocess, git operations)
- Human/UAT required: no (deterministic integration test — UAT is separate)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — all assertions pass
- All existing hypothesis tests still pass (43 + 49 + 69 + 99 = 260 assertions)
- `npx tsc --noEmit` — compiles clean
- R049 status is `validated` in REQUIREMENTS.md

## Observability / Diagnostics

- Runtime signals: `[hypothesis] phase →` on stderr during state transitions in test
- Inspection surfaces: HYPOTHESIS-STATE.json, EXPERIMENT-LOG.jsonl in test tmpdir
- Failure visibility: test name and assertion message on failure; JSONL entries inspectable post-mortem
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `generateNightShiftScaffold` (S03), `parseRoadmapSlices`/`parsePlan`/`parseCampaignConfig` (parsers), `buildResearch/Plan/Execute/VerifyPrompt` (S04), `readHypothesisState`/`writeHypothesisState`/`advanceHypothesisPhase`/`formatResultsForVerify` (S05), `runExperimentPostProcess`/`runEval` (eval-runner), `countExperiments`/`deriveState` (state)
- New wiring introduced in this slice: one-line fix in nightshift-interview.ts (startAuto verboseMode)
- What remains before the milestone is truly usable end-to-end: nothing — this is the final slice

## Tasks

- [x] **T01: Integration test proving scaffold→dispatch→eval→state composition** `est:35m`
  - Why: R049 requires proof that the assembled system works end-to-end. Individual component tests (260 assertions) cover units in isolation but don't prove they compose correctly. This test exercises the composition layer.
  - Files: `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts`, `src/resources/extensions/gsd/nightshift-interview.ts`
  - Do: (1) Fix startAuto 3-arg call at line 365 by adding explicit `false` verboseMode parameter. (2) Write integration test in tmpdir with real git repo: generate scaffold via `generateNightShiftScaffold`, parse through all three parsers, call all four prompt builders with real scaffold data, drive state machine through full hypothesis cycle (create initial state → advance through research→plan→execute→verify→plan+1), run eval against karpathy-smoke fixture via `runEval`, verify JSONL count matches state, verify multi-hypothesis transition (mark H1 complete via advanceHypothesisPhase to done, check deriveState finds H2 as next). Include naming compliance assertions (zero GSD/labrat in prompts). Follow existing test harness pattern (node:assert + custom test/assertInc wrappers).
  - Verify: `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — all pass, 0 fail
  - Done when: Integration test passes with ≥30 assertions covering scaffold roundtrip, builder parity, state transitions, eval execution, JSONL sync, and multi-hypothesis transition

- [x] **T02: Validate R049 and run full hypothesis test suite** `est:10m`
  - Why: Proves all 260+ existing assertions still pass alongside the new integration test, and records R049 as validated in REQUIREMENTS.md with concrete evidence.
  - Files: `.gsd/REQUIREMENTS.md`
  - Do: (1) Run all five hypothesis test files together. (2) Run `npx tsc --noEmit` to confirm clean compile. (3) Update R049 in REQUIREMENTS.md from `active`→`validated` with specific evidence (test file, assertion count, what was proven). Update traceability table and coverage counts.
  - Verify: `npx tsc --noEmit` clean, all 5 test files pass, R049 shows `validated` in REQUIREMENTS.md
  - Done when: R049 validated with evidence, all hypothesis tests pass, build compiles clean

## Files Likely Touched

- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` (new)
- `src/resources/extensions/gsd/nightshift-interview.ts` (1-line fix)
- `.gsd/REQUIREMENTS.md`
