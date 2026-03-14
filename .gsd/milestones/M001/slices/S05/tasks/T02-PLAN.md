---
estimated_steps: 3
estimated_files: 3
---

# T02: Per-experiment budget guard and full verification

**Slice:** S05 — Experiment Log, Crash Recovery & Supervision
**Milestone:** M001

## Description

Add per-experiment budget guard in `handleAgentEnd` that checks the just-completed experiment's cost against `budget_per_experiment` from research preferences and pauses if exceeded. Extend the supervision test suite with budget-specific tests. Run full regression to confirm nothing broke.

## Steps

1. In `auto.ts` `handleAgentEnd`, after the experiment post-processing block, add a per-experiment budget check: load research preferences, get `budget_per_experiment`. Call `snapshotUnitMetrics` (or read the latest ledger entry) to get the unit's cost. If cost > 0 and cost > `budget_per_experiment`, notify with cost details and pause auto-mode. If cost is 0, skip the check (provider didn't report cost — degrade gracefully per research guidance).

2. Extend `supervision.test.ts` with budget guard tests:
   - Per-experiment budget: cost exceeds `budget_per_experiment` → should trigger pause condition
   - Per-experiment budget: cost is 0 → should skip check (graceful degradation)
   - Per-experiment budget: no `budget_per_experiment` configured → should skip check
   - Campaign-level budget: verify existing `budget_ceiling` guard fires before experiment dispatch (existing behavior, just needs test coverage)

3. Run full regression: all existing test suites (`derive-state.test.ts`, `eval-runner.test.ts`, `research-types.test.ts`, `dispatch-guard.test.ts`, `git-experiment.test.ts`), plus `supervision.test.ts`, plus `npm run build`.

## Must-Haves

- [ ] Per-experiment budget check reads cost from metrics ledger after experiment completes
- [ ] Budget exceeded → UI notification with cost details + auto-mode pauses
- [ ] Zero cost → check skipped gracefully (no false pause)
- [ ] No `budget_per_experiment` configured → check skipped
- [ ] All existing test suites pass (no regressions)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/supervision.test.ts` — all assertions pass including budget tests
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 66/66 pass
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — all pass
- `npm run build` — exits 0

## Inputs

- `src/resources/extensions/gsd/auto.ts` — `handleAgentEnd` with experiment post-processing (from T01)
- `src/resources/extensions/gsd/metrics.ts` — `snapshotUnitMetrics`, `getLedger`, `getProjectTotals`
- `src/resources/extensions/gsd/preferences.ts` — `GSDResearchPreferences.budget_per_experiment`
- `src/resources/extensions/gsd/tests/supervision.test.ts` — test suite from T01

## Expected Output

- `src/resources/extensions/gsd/auto.ts` — per-experiment budget guard added in handleAgentEnd
- `src/resources/extensions/gsd/tests/supervision.test.ts` — extended with budget guard tests

## Observability Impact

- **New runtime signal:** UI notification on per-experiment budget exceeded — includes actual cost vs budget limit, visible in notification stream
- **Failure visibility:** Budget-triggered pause shows `formatCost` details so the operator can decide whether to adjust `budget_per_experiment` or continue
- **Graceful degradation:** When provider reports zero cost, budget check is silently skipped (no false pause, no warning noise)
- **Inspection surface:** Check `loadEffectiveGSDPreferences()?.preferences?.research?.budget_per_experiment` to see the active per-experiment budget; compare against session entry costs in the metrics ledger
