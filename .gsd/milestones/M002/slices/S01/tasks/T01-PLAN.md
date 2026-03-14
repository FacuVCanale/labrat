---
estimated_steps: 6
estimated_files: 4
---

# T01: Implement simplicity scorer module and integrate into keep/discard decisions

**Slice:** S01 — Simplicity-Aware Evaluation & Multi-File Safety
**Milestone:** M002

## Description

Create the `simplicity-scorer.ts` module with pure functions for computing code simplicity from diff-stat data, extend the type system with `DiffStat`/`SimplicityScore` types and optional fields on `CampaignConfig`/`ExperimentResult`, and integrate simplicity scoring into the existing `makeKeepDiscardDecision` function so that when `simplicityWeight > 0`, simpler code is preferred when metric improvements are within margin.

This is the first M002 module extraction (D039) — establishes the pattern of new `.ts` modules with pure functions called from eval-runner.ts/auto.ts.

## Steps

1. **Add types to `types.ts`**: `DiffStat` (linesAdded, linesRemoved, filesChanged), `SimplicityScore` (score 0–1, plus raw counts). Add optional `simplicityWeight?: number` to `CampaignConfig`. Add optional `simplicityScore?: SimplicityScore` to `ExperimentResult`.

2. **Create `simplicity-scorer.ts`**: Implement `extractNumericDiffStat(basePath: string): DiffStat` using `git diff --numstat HEAD~1..HEAD` (tab-separated: added, removed, filename per line). Implement `computeSimplicityScore(diffStat: DiffStat): SimplicityScore` — score = 1 / (1 + totalChurn) where totalChurn = linesAdded + linesRemoved. This gives a 0–1 score where less churn = higher simplicity.

3. **Extend `makeKeepDiscardDecision`**: Add optional params `simplicityWeight?: number` and `simplicityScore?: SimplicityScore`. When weight > 0 and score is present, compute blended score: `(1 - weight) * metricSignal + weight * simplicitySignal`. The metric signal is whether composite > 0 (mapped to 0/1). The simplicity signal is the simplicity score. A positive blended score → keep, otherwise discard. When weight is 0 or absent, behavior is identical to current (D042).

4. **Wire into `runExperimentPostProcess`**: After `extractDiffStat` (string description), also call `extractNumericDiffStat` → `computeSimplicityScore`. Read `simplicityWeight` from campaign config. Pass both to `makeKeepDiscardDecision`. Attach `simplicityScore` to the `ExperimentResult`.

5. **Verify `parseCampaignConfig` passthrough**: The existing shape validation only checks required fields — `simplicityWeight` is optional and passes through the `as CampaignConfig` cast. Confirm no changes needed in `state.ts`.

6. **Write contract tests** in `simplicity-scorer.test.ts`: computeSimplicityScore with zero churn (score=1), small churn, large churn. extractNumericDiffStat fallback on non-git directory. makeKeepDiscardDecision with simplicityWeight=0 matches M001 behavior. makeKeepDiscardDecision with simplicityWeight>0 prefers simpler code when metrics are within margin. ExperimentResult with simplicityScore round-trips through JSON. CampaignConfig with/without simplicityWeight both parse.

## Must-Haves

- [ ] `DiffStat` and `SimplicityScore` types in `types.ts`
- [ ] `CampaignConfig.simplicityWeight?: number` added without breaking existing parsing
- [ ] `ExperimentResult.simplicityScore?: SimplicityScore` added without breaking existing log reading
- [ ] `simplicity-scorer.ts` exports `computeSimplicityScore` and `extractNumericDiffStat`
- [ ] `makeKeepDiscardDecision` with `simplicityWeight=0` produces identical results to current behavior
- [ ] `makeKeepDiscardDecision` with `simplicityWeight>0` demonstrably prefers simpler code when metric composite is within margin
- [ ] Contract tests pass with ≥15 assertions covering scoring, integration, and backward compat

## Verification

- `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — all assertions pass, exit 0
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing 76 assertions still pass (no behavioral change)
- `npm run build` — compiles clean

## Observability Impact

- **New signals:** `ExperimentResult.simplicityScore` field added — every experiment now records its simplicity score (0–1) and raw diff-stat counts in `EXPERIMENT-LOG.jsonl`. `KeepDiscardDecision.reason` includes blended score value when `simplicityWeight > 0`.
- **Inspection:** Future agents can inspect simplicity behavior via: (a) `jq '.simplicityScore' EXPERIMENT-LOG.jsonl` to see per-experiment scores, (b) `CAMPAIGN.json` `simplicityWeight` field to check if simplicity scoring is enabled, (c) decision reason strings that include `blended score X.XXXX` when simplicity is active.
- **Failure visibility:** `extractNumericDiffStat` gracefully falls back to zero-churn on git failures (score = 1.0), logged as `{ linesAdded: 0, linesRemoved: 0, filesChanged: 0 }`. No silent failures — the fallback is visible in the persisted `simplicityScore`.

## Inputs

- `src/resources/extensions/gsd/types.ts` — existing `CampaignConfig`, `ExperimentResult`, `KeepDiscardDecision` types
- `src/resources/extensions/gsd/eval-runner.ts` — existing `makeKeepDiscardDecision`, `extractDiffStat`, `runExperimentPostProcess`
- `src/resources/extensions/gsd/state.ts` — existing `parseCampaignConfig` with shape validation
- D038 — diff-stat based scoring approach
- D039 — module extraction pattern
- D042 — backward compatibility requirement

## Expected Output

- `src/resources/extensions/gsd/simplicity-scorer.ts` — new module with pure scoring functions
- `src/resources/extensions/gsd/types.ts` — extended with `DiffStat`, `SimplicityScore`, optional fields on CampaignConfig/ExperimentResult
- `src/resources/extensions/gsd/eval-runner.ts` — `makeKeepDiscardDecision` and `runExperimentPostProcess` extended
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — contract tests for all scoring behavior
