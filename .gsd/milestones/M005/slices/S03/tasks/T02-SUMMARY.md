---
id: T02
parent: S03
milestone: M005
provides:
  - Contract test suite proving generateNightShiftScaffold roundtrips through parseRoadmapSlices, parsePlan, parseCampaignConfig
key_files:
  - src/resources/extensions/gsd/tests/nightshift-interview.test.ts
key_decisions: []
patterns_established:
  - Scaffold contract tests use tmpdir fixtures with cleanup; exercise generator then parse output through real parsers
observability_surfaces:
  - "npm test -- --test-name-pattern nightshift-interview: 8 test scenarios, 99 assertions — catches scaffold↔parser format drift"
duration: 15m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Contract tests proving scaffold parses correctly

**8 contract tests (99 assertions) proving `generateNightShiftScaffold` output roundtrips through all three parsers without silent failures.**

## What Happened

Created `nightshift-interview.test.ts` with 8 test scenarios exercising the scaffold→parser roundtrip contract:

1. **3×5 standard roundtrip** — roadmap parses 3 slices (S01-S03) all not-done, each plan parses 5 tasks (T01-T05) all not-done, CAMPAIGN.json validates with correct maxExperiments/targetFiles/evalConfig
2. **1×1 edge case** — single hypothesis, single experiment still parses through all three parsers
3. **10+ hypotheses ID padding** — S10/S11/S12 parse correctly (no zero-padding bugs)
4. **Priors present** — PRIORS.md created in each slice dir with user content; campaign.priors field populated
5. **Priors absent** — no PRIORS.md file created; campaign.priors undefined
6. **Mixed metric directions** — min and max directions plus weights preserved in CAMPAIGN.json evalConfig
7. **NightShift naming** — zero matches for GSD/labrat/Labrat in all generated files
8. **10+ experiments T-padding** — T10/T11/T12 task IDs parse correctly through parsePlan

## Verification

- `npm test -- --test-name-pattern nightshift-interview`: 99 passed, 0 failed
- `npm test` full suite: all tests pass (no regressions)
- `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts`: zero hits

### Slice-level verification (S03 final task):
- ✅ Contract tests pass: scaffold roundtrips through all three parsers
- ✅ `npm run build` compiles clean
- ✅ `npm test` full suite passes
- ✅ NightShift naming compliance — zero hits
- ✅ 10+ hypotheses ID padding verified (S10, S11 parse correctly)

## Diagnostics

- Run `npm test -- --test-name-pattern nightshift-interview` to verify scaffold↔parser roundtrip after any change to the interview module or parsers
- Each test prints `FAIL: <description>` with expected vs actual on mismatch; non-zero exit code triggers CI failure
- Tests use tmpdir fixtures cleaned up after each scenario — no disk residue

## Deviations

Added an 8th test (10+ experiments T-padding) beyond the 7 specified in the plan — validates task ID padding alongside slice ID padding.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` — Contract test file with 8 scenarios (99 assertions)
- `.gsd/milestones/M005/slices/S03/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
