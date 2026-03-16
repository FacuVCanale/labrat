---
estimated_steps: 4
estimated_files: 2
---

# T02: Contract tests proving scaffold parses correctly

**Slice:** S03 — /nightshift Interview & Scaffold
**Milestone:** M005

## Description

Write contract tests that prove `generateNightShiftScaffold()` output roundtrips through the three existing parsers (`parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig`). These tests are the objective stopping condition for S03 — if the generated scaffold doesn't parse, the state machine silently breaks and auto-mode can't dispatch experiments.

## Steps

1. **Create test file** — `nightshift-interview.test.ts` following the project's test pattern (custom assert/assertEq functions, tmpdir fixtures, node --test). Import `generateNightShiftScaffold` from the interview module, and `parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig` from their respective modules.

2. **Write parser roundtrip tests** — For each test case, call `generateNightShiftScaffold()` into a tmpdir, read the generated files, parse them through the respective parsers, and assert:
   - **3 hypotheses × 5 experiments**: roadmap has 3 slices (S01, S02, S03) all not done, plan for each has 5 tasks (T01-T05) all not done, CAMPAIGN.json validates with correct maxExperiments=5
   - **1 hypothesis × 1 experiment**: edge case — single slice, single task, still parses
   - **10+ hypotheses**: S10, S11 etc IDs parse correctly (no S010 zero-padding issue)
   - **Priors present**: PRIORS.md exists in each slice dir with user's content
   - **Priors absent**: no PRIORS.md file created
   - **Mixed metric directions**: metrics with min and max directions both preserved in CAMPAIGN.json evalConfig
   - **NightShift naming**: grep generated roadmap and plan files for GSD/labrat/Labrat — zero matches

3. **Wire into test runner** — Verify the test file is picked up by the existing glob `src/resources/extensions/gsd/tests/*.test.ts` in package.json's test script.

4. **Run and verify** — Execute `npm test` to confirm all new tests pass alongside existing tests (zero regressions).

## Must-Haves

- [ ] Tests exercise `parseRoadmapSlices` on generated roadmap content
- [ ] Tests exercise `parsePlan` on generated plan content
- [ ] Tests exercise `parseCampaignConfig` on generated CAMPAIGN.json
- [ ] At least 7 test scenarios covering normal, edge, and naming cases
- [ ] All tests pass: `npm test -- --test-name-pattern nightshift-interview`
- [ ] Existing tests unbroken: `npm test` full suite passes

## Verification

- `npm test -- --test-name-pattern nightshift-interview` — all assertions pass
- `npm test` — full suite passes (no regressions)

## Inputs

- `src/resources/extensions/gsd/nightshift-interview.ts` — the scaffold generator from T01
- `src/resources/extensions/gsd/roadmap-slices.ts` — `parseRoadmapSlices()`
- `src/resources/extensions/gsd/files.ts` — `parsePlan()`
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()`
- `src/resources/extensions/gsd/tests/derive-state.test.ts` — test pattern reference (assert/assertEq, tmpdir)

## Expected Output

- `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` — Contract test file with 7+ scenarios, all passing

## Observability Impact

- **New test signal:** `npm test -- --test-name-pattern nightshift-interview` runs 7+ contract tests. Any parser format drift in scaffold output surfaces as assertion failures here.
- **Failure inspection:** Each test prints `FAIL: <description>` with expected vs actual values on mismatch; non-zero exit code triggers CI failure.
- **Regression detection:** Tests run in the full `npm test` suite — if a future change to `parseRoadmapSlices`, `parsePlan`, or `parseCampaignConfig` breaks scaffold compatibility, these tests catch it.
- **Future agent diagnostic:** Run `npm test -- --test-name-pattern nightshift-interview` to verify scaffold→parser roundtrip after any change to the interview module or parsers.
