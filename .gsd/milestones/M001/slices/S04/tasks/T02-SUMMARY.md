---
id: T02
parent: S04
milestone: M001
provides:
  - extractDiffStat() function for git diff-stat summaries
  - ExperimentResult.description populated with real change context
key_files:
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/eval-runner.test.ts
key_decisions:
  - Extract diff-stat before any potential git revert — revert changes HEAD, so stat must be captured first
  - Used spawnSync (already imported) instead of execSync for consistency with rest of eval-runner
  - extractDiffStat exported as a named function for direct testability
patterns_established:
  - Diff-stat extraction pattern — spawnSync git diff --stat, filter to pipe-separated file lines, join multi-file results
observability_surfaces:
  - EXPERIMENT-LOG.jsonl description field now shows what files/lines changed instead of static 'eval post-process'
  - Fallback to 'eval post-process' signals git diff failed (first commit, non-git dir, etc.)
duration: 12m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Improve ExperimentResult description with diff-stat summary

**Replaced the hardcoded `'eval post-process'` description with git diff-stat summaries showing what files actually changed in each experiment.**

## What Happened

Added `extractDiffStat(basePath)` — uses `spawnSync('git', ['diff', '--stat', 'HEAD~1..HEAD'])` to get a concise summary of changes. Parses the stat output to extract file lines (e.g., `"train.py | 8 ++++---"`), joins multi-file diffs with commas, and falls back to `'eval post-process'` on any failure.

In `runExperimentPostProcess()`, the diff stat is extracted once at the top — before any potential `revertExperiment()` call that would change HEAD — and applied to all three result construction sites (missing config, all runs failed, normal path).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 73 passed, 0 failed (69 existing + 4 new)
- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 passed, 0 failed
- `npm run build` — clean compile
- New tests cover: single-file diff, multi-file diff, fallback on first commit (no HEAD~1), fallback on non-git directory

## Diagnostics

- Read EXPERIMENT-LOG.jsonl entries — `description` field shows what files/lines changed
- A static `'eval post-process'` description in the log signals the diff-stat fallback fired (git diff failed)
- `grep -n 'extractDiffStat' src/resources/extensions/gsd/eval-runner.ts` shows usage

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/eval-runner.ts` — added `extractDiffStat()`, updated all three result construction sites in `runExperimentPostProcess()`
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — added 4 tests for `extractDiffStat` (single-file, multi-file, first-commit fallback, non-git fallback)
