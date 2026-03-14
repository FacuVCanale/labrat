---
id: T02
parent: S01
milestone: M002
provides:
  - "validateTargetFiles function exported from eval-runner.ts"
  - "Pre-eval target file validation gate in runExperimentPostProcess"
key_files:
  - "src/resources/extensions/gsd/eval-runner.ts"
  - "src/resources/extensions/gsd/tests/target-file-validation.test.ts"
key_decisions:
  - "Follows D043 (post-commit git diff --name-only against targetFiles, revert on violation before eval)"
  - "Follows D026 (diff-stat extraction before revert)"
patterns_established:
  - "Pre-eval validation gate pattern: extract observability data first, validate, early-return with full result on violation"
  - "Safe default on git failure: treat as valid (no false rejects in non-git or single-commit scenarios)"
observability_surfaces:
  - "ExperimentResult.decision.reason contains 'target file violation: modified files outside target list [file1, file2]' when violations detected"
  - "ExperimentResult.simplicityScore attached to violation-reverted results (computed before revert)"
  - "EXPERIMENT-LOG.jsonl entries with empty metrics + violation reason distinguish target-file rejections from eval failures"
  - "Inspect violations: jq 'select(.decision.reason | test(\"target file violation\"))' EXPERIMENT-LOG.jsonl"
duration: 15m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Implement target file validation with pre-eval revert on violation

**Added `validateTargetFiles` function and pre-eval validation gate that catches out-of-scope file modifications and reverts without running eval.**

## What Happened

1. Added `validateTargetFiles(targetFiles, basePath)` to `eval-runner.ts` — runs `git diff --name-only HEAD~1..HEAD`, checks each changed file against the declared target set. Returns `{ valid, violations }`. On git failure (non-git dir, first commit), returns valid as safe default.

2. Inserted pre-eval validation in `runExperimentPostProcess` — positioned after diff-stat extraction and simplicity score computation but before the eval subprocess loop. On violation: builds a complete `ExperimentResult` with `decision: 'discard'`, reason listing violating files, and `simplicityScore` attached, then reverts and returns early. Eval never runs.

3. Moved simplicity score computation earlier in `runExperimentPostProcess` — it was previously computed after the eval loop. Now computed before the validation gate so that violation-reverted results include `simplicityScore` (must-have requirement).

4. Wrote 31 contract test assertions in `target-file-validation.test.ts` covering: valid single-target commits, single/multiple violations, exact subdirectory path matching, git failure safe defaults, first-commit safe defaults, pipeline integration (violation triggers revert without eval), and pipeline passthrough (valid files let eval run normally).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts` — **31 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73 passed, 0 failed** ✓ (backward compat)
- `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — **39 passed, 0 failed** ✓
- `npm run build` — compiles clean ✓

All slice-level verification checks pass.

## Diagnostics

- Target file violations in experiment log: `jq 'select(.decision.reason | test("target file violation"))' EXPERIMENT-LOG.jsonl`
- Violation reasons include the specific file list: `"target file violation: modified files outside target list [sneaky.py, utils.py]"`
- Violation-reverted results have `metrics: {}` (empty — eval never ran) plus `simplicityScore` (computed from diff before revert)
- Git failure in `validateTargetFiles` returns `{ valid: true, violations: [] }` — safe default, no false rejects

## Deviations

- Moved simplicity score computation earlier in `runExperimentPostProcess` (before the validation gate instead of after the eval loop). This was necessary to attach `simplicityScore` to violation-reverted results per the must-have requirement. The duplicate computation block after the eval loop was removed. No behavioral change for the normal (non-violation) path.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/eval-runner.ts` — Added `validateTargetFiles` function and pre-eval validation gate in `runExperimentPostProcess`; moved simplicity computation earlier
- `src/resources/extensions/gsd/tests/target-file-validation.test.ts` — New contract test file with 31 assertions covering validation logic and pipeline integration
- `.gsd/milestones/M002/slices/S01/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
