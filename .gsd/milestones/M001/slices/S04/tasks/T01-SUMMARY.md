---
id: T01
parent: S04
milestone: M001
provides:
  - buildExperimentPrompt() function assembling fresh context per experiment
  - readAllExperiments() and compressExperimentHistory() helpers in eval-runner.ts
  - run-experiment.md prompt template with five context sections
  - researchQuestion optional field on CampaignConfig
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/tests/experiment-prompt.test.ts
key_decisions:
  - buildExperimentPrompt is a private async function in auto.ts (not exported) — follows the pattern of other prompt builders
  - compressExperimentHistory falls back to diff hash prefix when description is 'eval post-process'
  - Missing target files get a ⚠ placeholder in the prompt (with stderr warning) instead of throwing
patterns_established:
  - Experiment prompt builder pattern — reads campaign config, target files, JSONL history, and best metrics, then calls loadPrompt with vars
observability_surfaces:
  - stderr warning when target file unreadable: `[gsd] buildExperimentPrompt: target file not found: <path>`
  - loadPrompt() throws with explicit missing-variable message if template/builder diverge
  - compressExperimentHistory output is human-readable in the prompt for debugging
duration: 25m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Build experiment prompt template, builder, and history helpers

**Replaced the 12-line stub experiment prompt with a real prompt builder that assembles campaign overview, target file source, best metrics, compressed experiment history, and safety-bounded instructions.**

## What Happened

1. Added optional `researchQuestion?: string` to `CampaignConfig` in types.ts. No changes needed to `parseCampaignConfig()` — the field is optional and existing shape validation only checks required fields.

2. Added `readAllExperiments(sliceDir)` to eval-runner.ts — reads EXPERIMENT-LOG.jsonl, parses each line, skips unparseable lines (same resilience pattern as `readBestMetrics`), returns all entries in file order.

3. Added `compressExperimentHistory(experiments, cap)` to eval-runner.ts — produces newest-first one-liner summaries like `exp-003: ✓ kept — val_bpb=1.4200 (train.py: +5/-3)`. Defaults to cap of 20. Falls back to diff hash when description is 'eval post-process'.

4. Created `prompts/run-experiment.md` template with five sections: campaign overview (research question, eval config, metric directions, budget), target file sources, best metrics, compressed experiment history, and instructions with safety boundary and eval-is-automatic directives.

5. Added `buildExperimentPrompt(mid, sid, basePath, experimentNumber)` async function in auto.ts. Reads campaign config, inlines target files (with stderr warning for missing files), reads history and best metrics, calls `loadPrompt("run-experiment", vars)`.

6. Replaced the stub prompt in `dispatchNextUnit` experimenting branch with `await buildExperimentPrompt(mid, sid, basePath, expNum)`.

7. Wrote contract tests covering all helpers and the full pipeline.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 passed, 0 failed
- `npm run build` — clean compile
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 66 passed (existing tests unbroken)

## Diagnostics

- Prompt template inspectable at `src/resources/extensions/gsd/prompts/run-experiment.md`
- Dispatch wiring: `grep -n 'buildExperimentPrompt' src/resources/extensions/gsd/auto.ts`
- Missing target file warning: check stderr for `[gsd] buildExperimentPrompt: target file not found:`
- Template/builder var mismatch: loadPrompt throws with explicit message listing missing variables

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added optional `researchQuestion` to `CampaignConfig`
- `src/resources/extensions/gsd/eval-runner.ts` — added `readAllExperiments()` and `compressExperimentHistory()` exports
- `src/resources/extensions/gsd/auto.ts` — added `buildExperimentPrompt()`, replaced stub, added imports
- `src/resources/extensions/gsd/prompts/run-experiment.md` — new prompt template with five context sections
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — 55 contract tests
- `.gsd/milestones/M001/slices/S04/S04-PLAN.md` — added diagnostic verification step
- `.gsd/milestones/M001/slices/S04/tasks/T01-PLAN.md` — added Observability Impact section
