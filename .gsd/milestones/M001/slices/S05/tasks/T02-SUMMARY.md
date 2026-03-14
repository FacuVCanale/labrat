---
id: T02
parent: S05
milestone: M001
provides:
  - Per-experiment budget guard in handleAgentEnd that pauses on overspend
  - Graceful degradation when provider reports zero cost
  - Budget guard test coverage in supervision test suite (11 new assertions)
  - Campaign-level budget_ceiling test coverage
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/tests/supervision.test.ts
key_decisions:
  - Compute experiment cost from session entries inline rather than calling snapshotUnitMetrics early — avoids dual-snapshot complexity and keeps metrics ledger append in its existing location (dispatchNextUnit)
  - Per-experiment budget uses strict > comparison (cost at exactly the budget does not trigger pause), while campaign-level budget_ceiling uses >= (at-or-over triggers)
patterns_established:
  - Budget guard reads cost from session entries using the same extraction pattern as snapshotUnitMetrics
  - Budget check is wrapped in try/catch with non-fatal semantics — budget check failure never blocks dispatch
observability_surfaces:
  - UI notification on per-experiment budget exceeded shows actual cost vs budget limit
  - Zero-cost graceful degradation is silent (no false pause, no warning)
  - Inspect budget_per_experiment via loadEffectiveGSDPreferences()?.preferences?.research?.budget_per_experiment
duration: 10min
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Per-experiment budget guard and full verification

**Added per-experiment budget guard in handleAgentEnd that checks experiment cost against budget_per_experiment and pauses auto-mode if exceeded, with graceful degradation for zero-cost providers.**

## What Happened

1. In `auto.ts` `handleAgentEnd`, after the experiment post-processing block (eval, lastProgressAt update), added a per-experiment budget check. The guard loads `budget_per_experiment` from research preferences, computes the experiment's cost by scanning session entries (same extraction pattern as `snapshotUnitMetrics`), and pauses auto-mode with a cost-detail notification if the cost exceeds the budget. When cost is 0 (provider didn't report), the check is silently skipped. When `budget_per_experiment` is undefined or 0, the check is skipped entirely.

2. Extended `supervision.test.ts` with 11 new assertions across 5 test groups:
   - Per-experiment budget: cost exceeds budget → triggers pause condition
   - Per-experiment budget: cost exactly at budget → does NOT trigger (strict >)
   - Per-experiment budget: cost under budget → does NOT trigger
   - Per-experiment budget: zero cost → skips check (graceful degradation)
   - Per-experiment budget: no budget configured or zero budget → skips check
   - Campaign-level budget_ceiling: total >= ceiling → triggers, exactly at ceiling → triggers, under → does not
   - Cost extraction: verifies summing of numeric and object-form cost entries, and zero-cost when cost field absent

3. Full regression: all test suites pass, build passes.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — 37 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 73 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — 113 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — 33 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/dispatch-guard.test.ts` — 4 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/git-experiment.test.ts` — 14 passed, 0 failed ✓
- `npm run build` — exits 0 ✓

### Slice-level verification
- `npx tsx supervision.test.ts` — all 37 assertions pass covering R007/R008/R009/R010 ✓
- `npx tsx derive-state.test.ts` — all 113 pass ✓
- `npm run build` — no type errors ✓

All slice verification checks pass. This is the final task of S05.

## Diagnostics

- UI notification on per-experiment budget exceeded: "Per-experiment budget exceeded: $X.XX spent vs $Y.YY limit. Pausing auto-mode."
- Zero-cost entries are silently skipped — no notification noise
- Budget check failures are caught and swallowed (non-fatal)

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/auto.ts` — added per-experiment budget guard after experiment post-processing in handleAgentEnd
- `src/resources/extensions/gsd/tests/supervision.test.ts` — added 11 budget guard assertions (5 test groups)
- `.gsd/milestones/M001/slices/S05/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
