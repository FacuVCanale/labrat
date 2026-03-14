---
estimated_steps: 3
estimated_files: 3
---

# T02: Implement target file validation with pre-eval revert on violation

**Slice:** S01 — Simplicity-Aware Evaluation & Multi-File Safety
**Milestone:** M002

## Description

Add `validateTargetFiles()` to the eval pipeline that checks whether an experiment commit modified only the declared target files. When violations are detected, the experiment is immediately reverted without running the eval command — saving eval time and enforcing multi-file safety (D043, CR001). This hardens the prompt-enforced safety boundary (D006) with a post-commit validation gate.

## Steps

1. **Add `validateTargetFiles` to `eval-runner.ts`**: Implement `validateTargetFiles(targetFiles: string[], basePath: string): { valid: boolean; violations: string[] }`. Runs `git diff --name-only HEAD~1..HEAD`, splits output into file list, checks each against `targetFiles`. Files not in the target list are violations. Returns `{ valid: true, violations: [] }` when all files are in scope.

2. **Insert pre-eval validation in `runExperimentPostProcess`**: After extracting diff-stat (both string and numeric) and computing simplicity score but before the eval subprocess loop, call `validateTargetFiles(config.targetFiles, basePath)`. On violation: build an `ExperimentResult` with `decision: 'discard'` and reason listing the violations, revert the commit, append to log, return early — eval never runs. This placement follows D026 (diff-stat before revert) and D043 (pre-eval validation).

3. **Write contract tests** in `target-file-validation.test.ts`: Set up real git repos with commits touching various files. Test: (a) commit touching only target files → valid, (b) commit touching an extra file → invalid with correct violation list, (c) commit touching a file in a subdirectory of target → handled correctly (exact path match), (d) `runExperimentPostProcess` with target file violation reverts without running eval (verify no subprocess spawned), (e) empty violations list for clean commit.

## Must-Haves

- [ ] `validateTargetFiles` exported from `eval-runner.ts`
- [ ] Violation detected before eval command runs (no wasted eval time)
- [ ] Violated experiments reverted with descriptive reason in the log entry
- [ ] `simplicityScore` still attached to violation-reverted results (computed from diff-stat before revert)
- [ ] Contract tests pass with ≥10 assertions covering validation logic and pipeline integration

## Verification

- `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts` — all assertions pass, exit 0
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing assertions still pass
- `npm run build` — compiles clean

## Inputs

- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess` from T01 (with simplicity scoring already wired)
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig.targetFiles`, `ExperimentResult` with `simplicityScore`
- `src/resources/extensions/gsd/simplicity-scorer.ts` — `extractNumericDiffStat`, `computeSimplicityScore` from T01
- D043 — post-commit `git diff --name-only` against targetFiles, revert on violation before eval

## Observability Impact

- **New signal:** `ExperimentResult.decision.reason` includes `"target file violation: [list]"` when experiments modify files outside `targetFiles`. Inspect with `jq 'select(.decision.reason | test("target file violation"))' EXPERIMENT-LOG.jsonl`.
- **New signal:** `ExperimentResult.simplicityScore` is attached to violation-reverted results (computed before revert), visible alongside the violation reason.
- **Failure visibility:** `validateTargetFiles` returns `{ valid: false, violations: [...] }` — the violation file list surfaces in both the return value and the logged `decision.reason`, making it clear which files triggered the revert.
- **Inspection:** A future agent can detect target file violations by grepping `EXPERIMENT-LOG.jsonl` for `"target file violation"` in the reason field. The absence of eval metrics (`metrics: {}`) alongside a violation reason distinguishes this path from eval failures.

## Expected Output

- `src/resources/extensions/gsd/eval-runner.ts` — `validateTargetFiles` function added, pre-eval hook in `runExperimentPostProcess`
- `src/resources/extensions/gsd/tests/target-file-validation.test.ts` — contract tests for validation + pipeline integration
