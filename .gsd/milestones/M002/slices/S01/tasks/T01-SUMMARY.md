---
id: T01
parent: S01
milestone: M002
provides:
  - "DiffStat and SimplicityScore types in types.ts"
  - "simplicity-scorer.ts module with computeSimplicityScore and extractNumericDiffStat"
  - "makeKeepDiscardDecision extended with optional simplicity blending"
  - "runExperimentPostProcess wired to compute and attach simplicity scores"
  - "CampaignConfig.simplicityWeight optional field (backward-compatible)"
  - "ExperimentResult.simplicityScore optional field (backward-compatible)"
key_files:
  - src/resources/extensions/gsd/simplicity-scorer.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/simplicity-scorer.test.ts
key_decisions:
  - "Follows D038 (diff-stat based scoring), D039 (module extraction), D042 (backward compat)"
patterns_established:
  - "Pure scoring modules with zero side effects called from eval-runner.ts orchestrator"
  - "Optional params object pattern for extending makeKeepDiscardDecision without breaking callers"
observability_surfaces:
  - "ExperimentResult.simplicityScore in EXPERIMENT-LOG.jsonl (inspect with jq '.simplicityScore')"
  - "KeepDiscardDecision.reason includes blended score details when simplicityWeight > 0"
  - "extractNumericDiffStat falls back to zero-churn on git failure (visible as score=1.0 in logs)"
duration: 25m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Implement simplicity scorer module and integrate into keep/discard decisions

**Added simplicity-scorer.ts module with pure scoring functions, extended makeKeepDiscardDecision with optional simplicity blending, and wired scoring into runExperimentPostProcess — default-off via simplicityWeight.**

## What Happened

1. Added `DiffStat` and `SimplicityScore` types to `types.ts`. Added optional `simplicityWeight?: number` to `CampaignConfig` and optional `simplicityScore?: SimplicityScore` to `ExperimentResult`.

2. Created `simplicity-scorer.ts` with two pure functions: `extractNumericDiffStat(basePath)` parses `git diff --numstat HEAD~1..HEAD` into `DiffStat`, and `computeSimplicityScore(diffStat)` computes `score = 1 / (1 + totalChurn)` producing a 0–1 value.

3. Extended `makeKeepDiscardDecision` with an optional `opts` parameter containing `simplicityWeight` and `simplicityScore`. When weight > 0, blends `(1 - weight) * metricSignal + weight * simplicitySignal`. When weight is 0 or absent, behavior is identical to M001.

4. Wired into `runExperimentPostProcess`: after metric aggregation, computes numeric diff-stat → simplicity score, reads `simplicityWeight` from campaign config, passes both to `makeKeepDiscardDecision`, and attaches `simplicityScore` to the result when weight > 0.

5. Verified `parseCampaignConfig` passthrough — shape validation only checks required fields, `simplicityWeight` passes through the `as CampaignConfig` cast. No changes needed in `state.ts`.

6. Wrote 39 contract test assertions in `simplicity-scorer.test.ts` covering score computation, diff-stat extraction fallback, backward compat with weight=0/absent, simplicity blending behavior, and JSON round-trip for both types.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — **39 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73 passed, 0 failed** ✓ (all existing tests pass unchanged)
- `npm run build` — **compiles clean** ✓

Slice-level verification status:
- ✅ `simplicity-scorer.test.ts` — all pass
- ⬜ `target-file-validation.test.ts` — not yet created (T02)
- ✅ `eval-runner.test.ts` — all 73 pass
- ✅ `npm run build` — clean

## Diagnostics

- Inspect per-experiment simplicity scores: `jq '.simplicityScore' EXPERIMENT-LOG.jsonl`
- Check if simplicity scoring is enabled: `jq '.simplicityWeight' CAMPAIGN.json`
- Decision reason strings include `blended score X.XXXX (metric=N, simplicity=Y.YYYY, weight=Z)` when simplicity is active
- Git failure in `extractNumericDiffStat` produces `{ linesAdded: 0, linesRemoved: 0, filesChanged: 0 }` → `score = 1.0` (safe default, visible in logs)

## Deviations

None. All six plan steps executed as written.

## Known Issues

- Existing eval-runner tests report 73 assertions (not 76 as stated in the plan). The 73 count is the actual count — the plan number was approximate.

## Files Created/Modified

- `src/resources/extensions/gsd/simplicity-scorer.ts` — new module with `extractNumericDiffStat` and `computeSimplicityScore`
- `src/resources/extensions/gsd/types.ts` — added `DiffStat`, `SimplicityScore` types; added optional fields on `CampaignConfig` and `ExperimentResult`
- `src/resources/extensions/gsd/eval-runner.ts` — extended `makeKeepDiscardDecision` with optional simplicity blending; wired scoring into `runExperimentPostProcess`
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — 39 contract test assertions for scoring, integration, and backward compat
- `.gsd/milestones/M002/slices/S01/S01-PLAN.md` — added Observability / Diagnostics section
- `.gsd/milestones/M002/slices/S01/tasks/T01-PLAN.md` — added Observability Impact section
