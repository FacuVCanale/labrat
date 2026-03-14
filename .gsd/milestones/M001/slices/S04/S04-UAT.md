# S04: Research Prompts & Fresh Context — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice produces prompt assembly logic with contract-testable inputs/outputs. No live runtime or human judgment needed — the prompt builder's behavior is fully determinable from its inputs.

## Preconditions

- Repository builds clean: `npm run build` passes
- Test infrastructure functional: `npx tsx` can run test files
- S02 and S03 work is present (types, state machine, eval-runner)

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — all 55 tests pass, confirming the prompt builder pipeline works end-to-end.

## Test Cases

### 1. Prompt contains all five context sections

1. Run `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts`
2. Locate the "contains campaign overview section" group of tests
3. **Expected:** Tests verify the assembled prompt contains: campaign overview (research question, eval command, metric directions), target file sources (inlined content), best metrics table, compressed experiment history, and instructions with safety boundary

### 2. History compression format

1. Create 3 `ExperimentResult` entries: one kept (improved metrics), one discarded (worse metrics), one with fallback description
2. Call `compressExperimentHistory(experiments, 20)`
3. **Expected:** Returns newest-first array of one-liner strings. Kept experiments show `✓ kept` with key metrics. Discarded show `✗ discarded`. Format: `exp-003: ✓ kept — val_bpb=1.4200 (train.py: +5/-3)`

### 3. History cap enforcement

1. Create 25 `ExperimentResult` entries
2. Call `compressExperimentHistory(experiments, 20)`
3. **Expected:** Returns exactly 20 entries, newest-first (experiments 25 through 6, skipping 1-5)

### 4. readAllExperiments reads JSONL

1. Write a temp JSONL file with 3 valid JSON lines (ExperimentResult objects)
2. Call `readAllExperiments(dir)` pointing at the temp directory
3. **Expected:** Returns array of 3 ExperimentResult objects in file order

### 5. readAllExperiments handles corrupted lines

1. Write a JSONL file with 2 valid lines and 1 corrupted line (invalid JSON) between them
2. Call `readAllExperiments(dir)`
3. **Expected:** Returns 2 valid entries, skips the corrupted line without throwing

### 6. Dispatch wiring

1. Run `grep -n 'buildExperimentPrompt' src/resources/extensions/gsd/auto.ts`
2. **Expected:** Shows the call at ~line 1315 (dispatch site) and the function definition at ~line 1822

### 7. Diff-stat extraction from git

1. In a temp git repo, create a commit modifying a single file
2. Call `extractDiffStat(repoPath)`
3. **Expected:** Returns string like `"file.txt | 3 +++"`

### 8. Diff-stat with multiple files

1. In a temp git repo, create a commit modifying two files
2. Call `extractDiffStat(repoPath)`
3. **Expected:** Returns comma-joined string like `"a.txt | 2 ++, b.txt | 1 +"`

### 9. Template variable coverage

1. Inspect `prompts/run-experiment.md` for all `{{variable}}` placeholders
2. Inspect `buildExperimentPrompt()` for the vars object passed to `loadPrompt()`
3. **Expected:** Every placeholder in the template has a matching key in the vars object. No orphan placeholders, no unused vars.

## Edge Cases

### No experiment history

1. Call `buildExperimentPrompt()` with an empty JSONL (or missing file)
2. **Expected:** Prompt still assembles successfully. History section shows "No experiments have been run yet" or equivalent placeholder. No crash.

### Missing target files

1. Call `buildExperimentPrompt()` with a campaign config pointing to a non-existent file
2. **Expected:** Prompt assembles with a `⚠` warning placeholder where the file content would go. stderr shows `[gsd] buildExperimentPrompt: target file not found: <path>`. No crash.

### No best metrics yet

1. Call `buildExperimentPrompt()` with no BEST-METRICS.json in the slice directory
2. **Expected:** Prompt assembles successfully. Best metrics section shows "No baseline metrics established yet" or equivalent. No crash.

### researchQuestion field

1. Create a CampaignConfig with `researchQuestion: "Can learning rate warmup improve convergence?"`
2. Call `buildExperimentPrompt()` with this config
3. **Expected:** The research question appears in the campaign overview section of the assembled prompt

### researchQuestion absent

1. Create a CampaignConfig without `researchQuestion`
2. Call `buildExperimentPrompt()` with this config
3. **Expected:** Falls back to campaign name. No crash, no empty field.

### First commit (no HEAD~1)

1. In a git repo with only one commit, call `extractDiffStat(repoPath)`
2. **Expected:** Returns `'eval post-process'` fallback. No crash.

## Failure Signals

- Any test in `experiment-prompt.test.ts` fails — prompt assembly pipeline broken
- Any test in `eval-runner.test.ts` fails — diff-stat or existing eval logic broken
- `npm run build` fails — type errors introduced by new code
- `grep 'buildExperimentPrompt' auto.ts` shows no results — dispatch wiring lost
- Prompt template has `{{variable}}` placeholders not matched by builder — loadPrompt will throw at runtime

## Requirements Proved By This UAT

- R005 (Fresh Context Per Experiment) — prompt builder delivers clean context with all five sections, edge cases handled
- R014 (Research Prompts) — experiment-oriented prompt with safety boundary, eval-is-automatic directive, and meaningful history

## Not Proven By This UAT

- Live runtime behavior — prompt builder is tested with mocked filesystem, not actual campaign execution
- LLM response quality — whether the prompt produces good code modifications requires end-to-end testing (S07)
- Integration with crash recovery — S05 owns experiment log resilience

## Notes for Tester

- All test cases above are already encoded in `experiment-prompt.test.ts` (55 tests) and `eval-runner.test.ts` (73 tests). Running both test files is the primary verification.
- The prompt template at `src/resources/extensions/gsd/prompts/run-experiment.md` is human-readable — worth a quick scan to confirm the five sections make sense as LLM instructions.
- The `buildExperimentPrompt` function is private (not exported). Test coverage is via the full pipeline tests that call it indirectly through mocked dispatch, plus direct tests of its component functions.
