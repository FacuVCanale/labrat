---
id: S04
parent: M001
milestone: M001
provides:
  - buildExperimentPrompt() — assembles fresh LLM context per experiment with five sections
  - run-experiment.md prompt template with campaign overview, target files, best metrics, history, instructions
  - readAllExperiments() — reads JSONL experiment log into ExperimentResult[]
  - compressExperimentHistory() — newest-first one-liner summaries, capped at 20
  - extractDiffStat() — git diff-stat summaries for experiment descriptions
  - researchQuestion optional field on CampaignConfig
requires:
  - slice: S02
    provides: Research types (CampaignConfig, ExperimentResult, ExperimentContext), state machine with experimenting phase, parseCampaignConfig(), CAMPAIGN.json format
affects:
  - S07
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/tests/experiment-prompt.test.ts
  - src/resources/extensions/gsd/tests/eval-runner.test.ts
key_decisions:
  - buildExperimentPrompt is a private async function in auto.ts — follows existing prompt builder pattern
  - Missing target files get a ⚠ placeholder with stderr warning instead of throwing (D025)
  - Diff-stat extracted before any potential git revert — revert changes HEAD
  - compressExperimentHistory falls back to diff hash prefix when description is 'eval post-process'
patterns_established:
  - Experiment prompt builder pattern — reads campaign config, target files, JSONL history, best metrics, calls loadPrompt with vars
  - Diff-stat extraction pattern — spawnSync git diff --stat, filter to pipe-separated file lines
observability_surfaces:
  - stderr warning when target file unreadable: `[gsd] buildExperimentPrompt: target file not found: <path>`
  - loadPrompt() throws with explicit missing-variable message if template/builder vars diverge
  - EXPERIMENT-LOG.jsonl description field shows real file changes instead of static 'eval post-process'
  - compressExperimentHistory output is human-readable for prompt debugging
drill_down_paths:
  - .gsd/milestones/M001/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S04/tasks/T02-SUMMARY.md
duration: 37m
verification_result: passed
completed_at: 2026-03-13
---

# S04: Research Prompts & Fresh Context

**Replaced the 12-line stub experiment prompt with a real prompt builder that gives the LLM fresh, experiment-oriented context — campaign overview, target file source, best metrics, compressed history, and safety-bounded instructions — plus git diff-stat descriptions for meaningful experiment history.**

## What Happened

The experiment dispatch path in auto.ts had a hardcoded stub prompt. This slice replaced it with two pieces of work:

**T01 — Prompt template and builder.** Created `prompts/run-experiment.md` with five sections: campaign overview (research question, eval config, metric directions, budget), target file sources (inlined), best metrics achieved so far, compressed experiment history (newest-first, capped at 20), and instructions with target file safety boundary and eval-is-automatic directives. Added `buildExperimentPrompt()` in auto.ts following the existing prompt builder pattern — reads campaign config, inlines target files (with graceful degradation for missing files), reads JSONL history via `readAllExperiments()`, compresses it via `compressExperimentHistory()`, reads best metrics, and calls `loadPrompt()`. The stub at line 1315 was replaced with the real call. Added `researchQuestion` optional field to `CampaignConfig` for explicit research question framing.

**T02 — Diff-stat descriptions.** Added `extractDiffStat()` to eval-runner.ts — uses `git diff --stat HEAD~1..HEAD` to summarize what files changed, producing descriptions like `"train.py | 8 ++++---"`. Integrated into `runExperimentPostProcess()` before any potential revert (since revert changes HEAD). Falls back to `'eval post-process'` when git diff fails (first commit, non-git dir). This makes the compressed history in prompts actually meaningful — experiments show what changed, not just metrics.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 passed, 0 failed
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 73 passed, 0 failed (69 existing + 4 new)
- `npm run build` — clean compile
- Observability confirmed: dispatch wiring at auto.ts:1315, prompt template inspectable, stderr warning for missing targets, diff-stat descriptions in JSONL

## Requirements Advanced

- R005 (Fresh Context Per Experiment) — `buildExperimentPrompt()` delivers clean LLM context with research question, target files, best results, and compressed history
- R014 (Research Prompts) — experiment-oriented prompt template replaces development-oriented stub, with safety boundary enforcement

## Requirements Validated

- R005 — 55 contract tests prove prompt assembly with all five sections, history compression, and edge cases (no history, missing files, no best metrics)
- R014 — prompt template verified to include all context sections, safety boundary, and eval-is-automatic directives

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- `buildExperimentPrompt()` is not exported — it's a private function in auto.ts. If future slices need to call it from outside dispatch, it would need refactoring.
- History cap of 20 is hardcoded. For very long campaigns this may be insufficient context, but prevents prompt bloat.
- `extractDiffStat()` uses `HEAD~1..HEAD` — works for normal experiments but will fall back on merge commits or octopus merges.

## Follow-ups

- none

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added optional `researchQuestion` to `CampaignConfig`
- `src/resources/extensions/gsd/eval-runner.ts` — added `readAllExperiments()`, `compressExperimentHistory()`, `extractDiffStat()` exports; updated result description in `runExperimentPostProcess()`
- `src/resources/extensions/gsd/auto.ts` — added `buildExperimentPrompt()`, replaced stub dispatch, added imports
- `src/resources/extensions/gsd/prompts/run-experiment.md` — new prompt template with five context sections
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 contract tests
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — 4 new tests for `extractDiffStat`

## Forward Intelligence

### What the next slice should know
- `buildExperimentPrompt()` reads JSONL via `readAllExperiments()` from the slice directory. S05's experiment log work should be aware this reader exists and maintains the same format.
- The prompt template uses `{{variables}}` — if new context sections are needed, add them to both the template and the builder's vars object (loadPrompt throws on mismatch).
- `extractDiffStat()` is exported from eval-runner.ts — available for S07's morning report if it wants to show change summaries.

### What's fragile
- `readAllExperiments()` does line-by-line JSON.parse — a corrupted JSONL line is silently skipped, which is correct for crash recovery but could hide data issues
- `loadPrompt()` uses simple `{{var}}` replacement — if a variable value contains `{{...}}`, it could interfere with other placeholders (unlikely in practice)

### Authoritative diagnostics
- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 tests covering the full prompt builder pipeline
- `grep -n 'buildExperimentPrompt' src/resources/extensions/gsd/auto.ts` — shows dispatch wiring and function definition
- EXPERIMENT-LOG.jsonl `description` field — if it shows `'eval post-process'`, diff-stat extraction failed

### What assumptions changed
- No assumptions changed — the stub was exactly where the plan said (lines 1315-1326) and the existing patterns (loadPrompt, inlineFile, parseCampaignConfig) worked as expected
