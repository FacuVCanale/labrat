# S01: Simplicity-Aware Evaluation & Multi-File Safety — UAT

**Milestone:** M002
**Written:** 2026-03-14

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice is pure contract-level work — scoring functions, validation logic, and decision blending. All behavior is provable through test assertions without a live runtime. No UI, no interactive flows, no server processes.

## Preconditions

- Repository cloned and `npm install` completed
- `npm run build` passes clean
- Git initialized with at least one prior commit (for diff-stat extraction tests)

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — should report 39 passed, 0 failed. This confirms the core simplicity scoring module loads, computes scores, and integrates with the decision pipeline.

## Test Cases

### 1. Simplicity score computation correctness

1. Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
2. Look for test sections: "zero churn → score = 1.0", "small churn", "large churn", "only additions"
3. **Expected:** All pass. Zero churn produces score 1.0. Higher churn produces lower scores (approaching 0). Score formula is `1 / (1 + linesAdded + linesRemoved)`.

### 2. Diff-stat extraction with git fallback

1. Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
2. Look for test sections: "fallback on non-git directory", "parses git numstat", "first commit (no HEAD~1) returns fallback"
3. **Expected:** All pass. Non-git directories and first commits return `{ linesAdded: 0, linesRemoved: 0, filesChanged: 0 }` (safe fallback producing score=1.0). Valid git repos parse numstat correctly.

### 3. Keep/discard decision with simplicity weight=0 (M001 backward compat)

1. Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
2. Look for test sections: "weight=0 matches M001 behavior — improvement", "weight=0 matches M001 behavior — regression", "absent opts matches M001 behavior"
3. **Expected:** All pass. With `simplicityWeight: 0` or no opts, decisions are identical to M001 — pure metric-based keep/discard with no simplicity influence.

### 4. Keep/discard decision with simplicity weight > 0

1. Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
2. Look for test sections: "weight>0 prefers simpler code when metric regresses", "weight>0 discards low-simplicity regression", "weight>0 metric improvement dominates"
3. **Expected:** All pass. When weight > 0: (a) a simpler solution with a slight metric regression can be kept, (b) a complex solution with a metric regression is discarded, (c) a clear metric improvement still wins regardless of simplicity.

### 5. CampaignConfig and ExperimentResult backward compatibility

1. Run `npx tsx src/resources/extensions/gsd/tests/simplicity-scorer.test.ts`
2. Look for test sections: "CampaignConfig with simplicityWeight parses", "CampaignConfig without simplicityWeight parses", "ExperimentResult with simplicityScore round-trips", "ExperimentResult without simplicityScore still parses"
3. **Expected:** All pass. M001-era configs (no `simplicityWeight`) parse identically. New fields are optional — presence and absence both work.

### 6. Target file validation — valid commits pass through

1. Run `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts`
2. Look for test sections: "commit touching only target files → valid", "multiple target files — all in scope"
3. **Expected:** All pass. Commits that modify only declared target files produce `{ valid: true, violations: [] }`.

### 7. Target file validation — violations detected

1. Run `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts`
2. Look for test sections: "commit touching extra file → invalid", "multiple violations", "subdirectory file — exact path match"
3. **Expected:** All pass. Files modified outside the target list are reported as violations. Subdirectory paths match exactly (no prefix confusion).

### 8. Target file validation — git failure safe defaults

1. Run `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts`
2. Look for test sections: "git failure (non-git dir) → safe default valid", "first commit (no HEAD~1) → safe default valid"
3. **Expected:** All pass. When git is unavailable or there's no prior commit, validation returns valid (no false rejects).

### 9. Pipeline integration — violation triggers revert without eval

1. Run `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts`
2. Look for test section: "pipeline: target file violation → revert without running eval"
3. **Expected:** Passes. When a commit modifies files outside the target list, `runExperimentPostProcess` reverts the commit and returns a discard result without ever running the eval command. Result includes `decision: 'discard'`, reason mentions "target file violation", and `metrics` is empty.

### 10. Pipeline integration — valid files allow eval

1. Run `npx tsx src/resources/extensions/gsd/tests/target-file-validation.test.ts`
2. Look for test section: "pipeline: valid target files → eval runs normally"
3. **Expected:** Passes. When all modified files are in the target list, eval runs normally and metrics are populated.

### 11. Existing eval-runner tests unchanged

1. Run `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts`
2. **Expected:** 73 passed, 0 failed. All M001-era eval-runner tests pass without modification, proving zero behavioral regression.

### 12. Build verification

1. Run `npm run build`
2. **Expected:** Compiles clean with no errors. All new types and modules are properly exported and imported.

## Edge Cases

### Zero simplicity weight with high simplicity score

1. Set `simplicityWeight: 0` in campaign config with a high simplicity score on the experiment
2. **Expected:** Simplicity score has zero influence on the keep/discard decision. Decision is purely metric-based.

### Git failure during diff-stat extraction in production

1. `extractNumericDiffStat` is called in a non-git directory or before first commit
2. **Expected:** Returns `{ linesAdded: 0, linesRemoved: 0, filesChanged: 0 }`, which maps to `score = 1.0` (maximum simplicity — safe default that won't penalize the experiment).

### Empty targetFiles array

1. Campaign config has `targetFiles: []` (no files declared)
2. **Expected:** All modified files are violations since nothing is in the allowed set. Validated in contract tests.

### Violation-reverted result carries simplicity score

1. An experiment modifies files outside the target list AND simplicity scoring is enabled
2. **Expected:** The reverted result includes `simplicityScore` (computed before revert) even though eval never ran. This preserves observability.

## Failure Signals

- Any test file reporting failures (non-zero exit code from tsx)
- `npm run build` reporting TypeScript compilation errors
- `eval-runner.test.ts` assertion count dropping below 73 (indicates broken backward compat)
- `makeKeepDiscardDecision` returning different results with `simplicityWeight: 0` vs no opts (backward compat violation)

## Requirements Proved By This UAT

- R017 (Simplicity-Aware Keep/Discard) — Test cases 1-5 prove configurable simplicity scoring with backward-compatible default-off behavior
- R019 (Multi-File Experiment Scope) — Test cases 6-10 prove target file validation with pre-eval revert on violation

## Not Proven By This UAT

- Live autonomous loop with `simplicityWeight > 0` producing visible simplicity scores in EXPERIMENT-LOG.jsonl (requires real LLM + eval — deferred to M002 UAT)
- Live multi-file experiment caught and reverted during an actual campaign run (requires real LLM — deferred to M002 UAT)
- Interaction between simplicity scoring and agenda phases (S02 scope)
- Runtime steering influence on simplicity thresholds (S03 scope)

## Notes for Tester

- All tests are self-contained contract tests using `assert`/`assertEq` with process exit codes — no test runner needed.
- The target-file-validation tests create temporary git repos, make commits, and clean up after themselves. They take ~30 seconds to run due to git operations.
- The simplicity scorer tests are fast (sub-second) — most test pure functions without git.
- If running all three test files sequentially, expect ~45 seconds total runtime.
