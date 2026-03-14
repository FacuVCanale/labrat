---
estimated_steps: 3
estimated_files: 2
---

# T02: Improve ExperimentResult description with diff-stat summary

**Slice:** S04 — Research Prompts & Fresh Context
**Milestone:** M001

## Description

The `ExperimentResult.description` field is hardcoded to `'eval post-process'` in `runExperimentPostProcess()`. This makes compressed experiment history useless — every entry says the same thing. Extract a diff-stat summary from git so history entries show what actually changed (e.g., `"train.py | 8 ++++---"`).

## Steps

1. In `runExperimentPostProcess()` in eval-runner.ts, after the keep/discard decision, extract a diff-stat summary using `execSync('git diff --stat HEAD~1..HEAD', { cwd: basePath })`. Parse the stat output into a concise one-liner (e.g., `"train.py | 8 ++++---"`). If the diff covers multiple files, include all. Wrap in try/catch — fall back to `'eval post-process'` if git diff fails (e.g., first commit on branch). Set `result.description` to this summary for all three result construction sites in the function.

2. Update `tests/eval-runner.test.ts` — add test(s) verifying that `ExperimentResult.description` is populated from the diff stat when available. Since the orchestrator tests use a real git repo (tmp dir), the diff stat extraction should work in tests. Verify fallback when git diff fails.

3. Run `npm run build` and all eval-runner tests to confirm nothing breaks.

## Must-Haves

- [ ] `ExperimentResult.description` contains diff-stat summary for normal experiments
- [ ] Graceful fallback to `'eval post-process'` when git diff fails
- [ ] Existing eval-runner tests still pass
- [ ] Build clean

## Verification

- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — all tests pass (existing + new)
- `npm run build` — clean compile

## Observability Impact

- Signals added/changed: `ExperimentResult.description` now carries change context instead of a static string
- How a future agent inspects this: read EXPERIMENT-LOG.jsonl entries — `description` field shows what files/lines changed
- Failure state exposed: if git diff fails, description falls back to `'eval post-process'` — a static description in the log signals the fallback fired

## Inputs

- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess()` with three result construction sites
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing orchestrator tests using real git repos

## Expected Output

- `src/resources/extensions/gsd/eval-runner.ts` — description populated from diff-stat in all result paths
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — additional test(s) for description field
