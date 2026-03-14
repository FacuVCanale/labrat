---
id: S01
parent: M002
milestone: M002
provides:
  - "DiffStat and SimplicityScore types in types.ts"
  - "simplicity-scorer.ts module with computeSimplicityScore and extractNumericDiffStat"
  - "makeKeepDiscardDecision extended with optional simplicity blending"
  - "runExperimentPostProcess wired to compute and attach simplicity scores"
  - "CampaignConfig.simplicityWeight optional field (backward-compatible)"
  - "ExperimentResult.simplicityScore optional field (backward-compatible)"
  - "validateTargetFiles function exported from eval-runner.ts"
  - "Pre-eval target file validation gate in runExperimentPostProcess"
requires:
  - slice: none
    provides: "first slice in M002"
affects:
  - S02
  - S03
key_files:
  - src/resources/extensions/gsd/simplicity-scorer.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/simplicity-scorer.test.ts
  - src/resources/extensions/gsd/tests/target-file-validation.test.ts
key_decisions:
  - "D038: Diff-stat based simplicity scoring (language-agnostic, already extracted)"
  - "D039: Module extraction pattern (new .ts modules called from eval-runner.ts)"
  - "D042: CampaignConfig backward compat (optional fields, M001 configs parse identically)"
  - "D043: Post-commit target file validation with immediate revert on violation"
patterns_established:
  - "Pure scoring modules with zero side effects called from eval-runner.ts orchestrator"
  - "Optional params object pattern for extending makeKeepDiscardDecision without breaking callers"
  - "Pre-eval validation gate pattern: extract observability data first, validate, early-return with full result on violation"
  - "Safe default on git failure: treat as valid (no false rejects in non-git or single-commit scenarios)"
observability_surfaces:
  - "ExperimentResult.simplicityScore in EXPERIMENT-LOG.jsonl (inspect with jq '.simplicityScore')"
  - "KeepDiscardDecision.reason includes blended score details when simplicityWeight > 0"
  - "extractNumericDiffStat falls back to zero-churn on git failure (visible as score=1.0 in logs)"
  - "Target file violations in decision.reason: 'target file violation: modified files outside target list [file1, file2]'"
  - "Inspect violations: jq 'select(.decision.reason | test(\"target file violation\"))' EXPERIMENT-LOG.jsonl"
drill_down_paths:
  - .gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md
duration: 40m
verification_result: passed
completed_at: 2026-03-14
---

# S01: Simplicity-Aware Evaluation & Multi-File Safety

**Evaluation pipeline now factors in code simplicity via configurable diff-stat scoring, and catches out-of-scope file modifications with pre-eval revert — both default-off, backward-compatible with M001.**

## What Happened

Created `simplicity-scorer.ts` module with two pure functions: `extractNumericDiffStat(basePath)` parses `git diff --numstat HEAD~1..HEAD` into a `DiffStat`, and `computeSimplicityScore(diffStat)` computes `score = 1 / (1 + totalChurn)` producing a 0–1 value where lower churn = higher score. Added `DiffStat` and `SimplicityScore` types to `types.ts` alongside optional `simplicityWeight` on `CampaignConfig` and optional `simplicityScore` on `ExperimentResult`.

Extended `makeKeepDiscardDecision` with an optional `opts` parameter for `simplicityWeight` and `simplicityScore`. When weight > 0, blends `(1 - weight) * metricSignal + weight * simplicitySignal` so that a simpler solution with slightly lower metrics can still win. When weight is 0 or absent, behavior is identical to M001.

Added `validateTargetFiles(targetFiles, basePath)` to `eval-runner.ts` — runs `git diff --name-only HEAD~1..HEAD`, checks each changed file against the declared target set. Returns `{ valid, violations }`. On git failure returns valid as safe default (no false rejects).

Wired both features into `runExperimentPostProcess`: compute diff-stat → simplicity score → validate target files → on violation, revert immediately without eval. The simplicity score computation was moved before the validation gate so that even violation-reverted results carry the score for observability.

All 73 existing eval-runner tests pass unchanged — zero behavioral regression for weight=0 or absent configs.

## Verification

- `simplicity-scorer.test.ts` — **39 passed, 0 failed** ✓ (scoring logic, diff-stat extraction, backward compat, blending behavior)
- `target-file-validation.test.ts` — **31 passed, 0 failed** ✓ (validation logic, violation detection, pipeline integration, safe defaults)
- `eval-runner.test.ts` — **73 passed, 0 failed** ✓ (all existing tests unchanged)
- `npm run build` — compiles clean ✓

Total new assertions: 70 (39 + 31). Existing test suite: 73 eval-runner assertions unchanged.

## Requirements Advanced

- R017 (Simplicity-Aware Keep/Discard) — Fully implemented: configurable `simplicityWeight`, diff-stat scoring, blended keep/discard decisions. Proven by 39 contract tests.
- R019 (Multi-File Experiment Scope) — Target file validation gate implemented: post-commit `git diff --name-only` against `targetFiles[]`, immediate revert on violation. Proven by 31 contract tests.

## Requirements Validated

- R017 — `computeSimplicityScore` produces 0–1 score from diff stats; `makeKeepDiscardDecision` prefers simpler code when metrics are within margin and `simplicityWeight > 0`; weight=0/absent produces identical behavior to M001. 39 contract tests.
- R019 — `validateTargetFiles` detects out-of-scope modifications; `runExperimentPostProcess` reverts without running eval on violation; git failure safely defaults to valid. 31 contract tests.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- Moved simplicity score computation earlier in `runExperimentPostProcess` (before the validation gate instead of after the eval loop). Necessary to attach `simplicityScore` to violation-reverted results. No behavioral change for the normal path.
- Existing eval-runner tests count is 73, not 76 as estimated in the slice plan. The 73 count is the actual verified count.

## Known Limitations

- Simplicity scoring uses diff-stat (lines changed) as a proxy for complexity — this is language-agnostic but has failure modes (refactoring that increases lines but improves clarity). Configurable weight with default-off mitigates this.
- Target file validation relies on `git diff --name-only HEAD~1..HEAD` — requires at least two commits on the branch. First-commit and non-git scenarios safely default to valid.

## Follow-ups

None — all planned work completed. S02 (Research Agenda Planning) is the next slice.

## Files Created/Modified

- `src/resources/extensions/gsd/simplicity-scorer.ts` — new module with `extractNumericDiffStat` and `computeSimplicityScore`
- `src/resources/extensions/gsd/types.ts` — added `DiffStat`, `SimplicityScore` types; added optional `simplicityWeight` on `CampaignConfig`, optional `simplicityScore` on `ExperimentResult`
- `src/resources/extensions/gsd/eval-runner.ts` — extended `makeKeepDiscardDecision` with simplicity blending; added `validateTargetFiles`; wired both into `runExperimentPostProcess`
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — 39 contract test assertions
- `src/resources/extensions/gsd/tests/target-file-validation.test.ts` — 31 contract test assertions

## Forward Intelligence

### What the next slice should know
- The module extraction pattern is established: pure-function `.ts` module called from `eval-runner.ts` (or `auto.ts`). `simplicity-scorer.ts` is the reference implementation. Follow the same pattern for `agenda.ts` and `steering.ts`.
- `CampaignConfig` extension is additive — optional fields with sensible defaults. `parseCampaignConfig` uses shape validation on required fields only, so new optional fields pass through the `as CampaignConfig` cast. No changes needed in `state.ts` for new optional fields.
- `ExperimentResult` extension follows the same pattern — optional fields that JSON round-trip cleanly.

### What's fragile
- `runExperimentPostProcess` is now the main orchestration point with multiple gates (diff-stat → simplicity → target validation → eval loop → keep/discard). Order matters — diff-stat must be extracted before any potential revert. Adding new gates must maintain this ordering.
- `makeKeepDiscardDecision` optional params pattern works for 2 params but may need refactoring if S02 adds more decision factors. Current signature: `makeKeepDiscardDecision(compositeScore, isFirstExperiment, opts?)`.

### Authoritative diagnostics
- `jq '.simplicityScore' EXPERIMENT-LOG.jsonl` — per-experiment simplicity scores (null when weight=0)
- `jq 'select(.decision.reason | test("target file violation"))' EXPERIMENT-LOG.jsonl` — target file violations
- `jq '.simplicityWeight' CAMPAIGN.json` — whether simplicity scoring is enabled

### What assumptions changed
- Plan estimated 76 eval-runner test assertions — actual count is 73. Not a regression, just an inaccurate estimate in the plan.
