# S01: Simplicity-Aware Evaluation & Multi-File Safety

**Goal:** The experiment evaluation pipeline factors in code simplicity when making keep/discard decisions (configurable, default-off), and catches experiments that modify files outside the declared target list before running eval.

**Demo:** Contract tests prove: (a) `computeSimplicityScore` produces a 0–1 score from diff-stat data, (b) `makeKeepDiscardDecision` prefers simpler code when metrics are within margin and `simplicityWeight > 0`, (c) `simplicityWeight: 0` (or absent) produces identical behavior to M001, (d) `validateTargetFiles` detects out-of-scope file modifications, (e) `runExperimentPostProcess` reverts without running eval when target file violations are found, (f) existing M001-era `parseCampaignConfig` tests still pass with no changes.

## Must-Haves

- `simplicity-scorer.ts` module with `computeSimplicityScore(diffStat: DiffStat): SimplicityScore` and `extractNumericDiffStat(basePath: string): DiffStat`
- `SimplicityScore` type (`{ score: number; linesAdded: number; linesRemoved: number; filesChanged: number }`) and `DiffStat` type exported from types
- `CampaignConfig.simplicityWeight?: number` — optional, backward-compatible, defaults to 0
- `ExperimentResult.simplicityScore?: SimplicityScore` — optional, backward-compatible
- `makeKeepDiscardDecision` accepts optional `simplicityWeight` and `simplicityScore`, blends metric composite score with simplicity when weight > 0
- `validateTargetFiles(targetFiles: string[], basePath: string): { valid: boolean; violations: string[] }` — checks `git diff --name-only HEAD~1..HEAD` against target list
- Pre-eval hook in `runExperimentPostProcess` reverts and logs when target file violations are found (before running eval command)
- All existing tests pass unchanged — zero behavioral regression for `simplicityWeight: 0` or absent

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — all assertions pass (scoring logic, edge cases, DiffStat extraction fallback)
- `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts` — all assertions pass (validation logic, violation detection, revert-on-violation in runExperimentPostProcess)
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing 76 assertions still pass (backward compatibility)
- `npm run build` — compiles clean with new types and modules

## Observability / Diagnostics

- **Runtime signals:** `ExperimentResult.simplicityScore` persists in `EXPERIMENT-LOG.jsonl` — inspect with `jq '.simplicityScore' EXPERIMENT-LOG.jsonl` to see per-experiment simplicity scores. `KeepDiscardDecision.reason` includes the blended score when `simplicityWeight > 0`, making the scoring visible in logs.
- **Inspection surfaces:** `CAMPAIGN.json` contains `simplicityWeight` (absence = 0 = off). `EXPERIMENT-LOG.jsonl` entries include `simplicityScore.score` (0–1) and raw diff counts (`linesAdded`, `linesRemoved`, `filesChanged`). Target file violations appear in `decision.reason` with the list of violating files.
- **Failure visibility:** `extractNumericDiffStat` returns `{ linesAdded: 0, linesRemoved: 0, filesChanged: 0 }` when git fails — this maps to `simplicityScore.score = 1.0` (maximum simplicity fallback, safe default). `validateTargetFiles` logs violations in `decision.reason` and triggers immediate revert before wasting eval time.
- **Redaction constraints:** None — no secrets or PII in diff-stat data or simplicity scores.

## Integration Closure

- Upstream surfaces consumed: `eval-runner.ts` (makeKeepDiscardDecision, runExperimentPostProcess, extractDiffStat), `types.ts` (CampaignConfig, ExperimentResult), `state.ts` (parseCampaignConfig)
- New wiring introduced in this slice: `simplicity-scorer.ts` called from `eval-runner.ts`; `validateTargetFiles` called from `runExperimentPostProcess` before eval subprocess
- What remains before the milestone is truly usable end-to-end: S02 (agenda planning/execution), S03 (runtime steering)

## Tasks

- [x] **T01: Implement simplicity scorer module and integrate into keep/discard decisions** `est:1h`
  - Why: Core of R017 — the evaluation pipeline must factor in code complexity when `simplicityWeight > 0`, prefer simpler code when metrics are within margin, and produce identical behavior when weight is 0 or absent
  - Files: `src/resources/extensions/gsd/simplicity-scorer.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
  - Do: (1) Add `DiffStat` and `SimplicityScore` types to `types.ts`; add optional `simplicityWeight` to `CampaignConfig` and optional `simplicityScore` to `ExperimentResult`. (2) Create `simplicity-scorer.ts` with `extractNumericDiffStat(basePath)` (parses `git diff --numstat HEAD~1..HEAD`) and `computeSimplicityScore(diffStat)` (inverse of total churn, normalized 0–1). (3) Extend `makeKeepDiscardDecision` with optional `simplicityWeight` and `simplicityScore` params — when weight > 0, blend composite metric score with simplicity score so that a simpler solution with a slightly lower metric score can still win. (4) Wire into `runExperimentPostProcess`: compute DiffStat → SimplicityScore → attach to result → pass to decision. (5) Ensure `parseCampaignConfig` passes through `simplicityWeight` without breaking on M001 configs. (6) Write contract tests covering: score computation from various diff stats, keep/discard behavior with/without simplicity weight, backward compat with weight=0/absent.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` passes, `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` passes unchanged, `npm run build` clean
  - Done when: `simplicityScore` appears in ExperimentResult, `makeKeepDiscardDecision` demonstrably prefers simpler code when configured, zero regression on existing tests

- [x] **T02: Implement target file validation with pre-eval revert on violation** `est:45m`
  - Why: Core of R019/CR001 — experiments that modify files outside the declared `targetFiles` must be caught post-commit and reverted before wasting eval time (D043)
  - Files: `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/tests/target-file-validation.test.ts`
  - Do: (1) Add `validateTargetFiles(targetFiles: string[], basePath: string): { valid: boolean; violations: string[] }` to `eval-runner.ts` — runs `git diff --name-only HEAD~1..HEAD`, filters against targetFiles list, returns violations. (2) Insert validation call in `runExperimentPostProcess` between `extractDiffStat`/`extractNumericDiffStat` and the eval subprocess loop — on violation, revert immediately without running eval, log result with `decision: 'discard'` and reason listing violations. (3) Write contract tests in a real git repo: commit that touches only target files passes validation, commit that touches extra files fails, violation triggers revert path in runExperimentPostProcess, empty targetFiles array (edge case).
  - Verify: `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts` passes, existing eval-runner tests still pass, `npm run build` clean
  - Done when: A multi-file experiment that modifies files outside `targetFiles` is caught post-commit and reverted without running the eval command, proven by contract tests

## Files Likely Touched

- `src/resources/extensions/gsd/simplicity-scorer.ts` (new)
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/eval-runner.ts`
- `src/resources/extensions/gsd/state.ts` (minor — parseCampaignConfig passthrough)
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` (new)
- `src/resources/extensions/gsd/tests/target-file-validation.test.ts` (new)
