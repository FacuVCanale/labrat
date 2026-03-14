---
estimated_steps: 7
estimated_files: 5
---

# T01: Build experiment prompt template, builder, and history helpers

**Slice:** S04 — Research Prompts & Fresh Context
**Milestone:** M001

## Description

Replace the 12-line stub experiment prompt in auto.ts with a real prompt builder that assembles fresh context per experiment: campaign overview, target file source, best metrics, compressed experiment history, and instructions. Create the prompt template, history helpers, and contract tests.

## Steps

1. Add optional `researchQuestion?: string` to `CampaignConfig` in types.ts. Update `parseCampaignConfig()` in state.ts — the field is optional so validation doesn't require it; existing configs without it still parse fine.

2. Add `readAllExperiments(sliceDir: string): ExperimentResult[]` to eval-runner.ts. Reads EXPERIMENT-LOG.jsonl, parses each line, skips unparseable lines (same resilience as `readBestMetrics`). Returns all entries in file order.

3. Add `compressExperimentHistory(experiments: ExperimentResult[], cap?: number): string` to eval-runner.ts. Takes experiment results, produces a formatted block of one-liner summaries: `exp-003: ✓ kept — val_bpb=1.42 (train.py: +5/-3)` or `exp-002: ✗ discarded — regression (val_bpb=1.55)`. Newest-first ordering. Cap defaults to 20. Uses `description` field for change context (falls back to diff hash if description is unhelpful). Metrics formatted to 4 decimal places.

4. Create `prompts/run-experiment.md` template with `{{variable}}` placeholders. Five sections: (a) Campaign overview with research question, eval config, metric directions, budget. (b) Target files — full source inlined. (c) Best metrics — current bar to beat. (d) Compressed experiment history. (e) Instructions — modify target files to improve metrics, explain reasoning, do NOT run the eval command, do NOT modify anything outside target files. Safety boundary (D006) and eval-is-automatic directives prominently placed.

5. Add `buildExperimentPrompt(mid, sid, basePath, experimentNumber)` async function in auto.ts. Pattern: read campaign config via `parseCampaignConfig()`, read target files via `inlineFile()`, read history via `readAllExperiments()` + `compressExperimentHistory()`, read best metrics via `readBestMetrics()`, call `loadPrompt("run-experiment", vars)`. Handle gracefully: missing target files (warn in prompt), no history (empty section), no best metrics (say "no baseline yet").

6. Replace the stub prompt in `dispatchNextUnit` (lines 1308-1326 experimenting branch) with a call to `buildExperimentPrompt()`. The function is async — the dispatch block already uses `await` for other prompt builders.

7. Write `tests/experiment-prompt.test.ts` with contract tests:
   - `readAllExperiments` parses JSONL correctly, skips bad lines, returns empty array for missing file
   - `compressExperimentHistory` produces correct format, respects cap, handles empty input, newest-first ordering
   - `buildExperimentPrompt` produces prompt containing all five sections (test with a temp directory containing a CAMPAIGN.json, target file, and EXPERIMENT-LOG.jsonl)
   - Edge cases: no experiment history, missing target files, no best metrics, `researchQuestion` fallback to `config.name`

## Must-Haves

- [ ] `researchQuestion` optional on `CampaignConfig`, `parseCampaignConfig` unchanged for existing configs
- [ ] `readAllExperiments()` reads JSONL with malformed-line resilience
- [ ] `compressExperimentHistory()` produces one-liner summaries, newest-first, capped at 20
- [ ] `prompts/run-experiment.md` template with all five context sections
- [ ] `buildExperimentPrompt()` assembles context and calls `loadPrompt()`
- [ ] Stub in dispatch replaced with real prompt builder call
- [ ] Prompt includes safety boundary (only target files) and eval-is-automatic directive
- [ ] Contract tests pass

## Observability Impact

- `buildExperimentPrompt()` logs a warning to stderr (`process.stderr.write`) when a target file is unreadable — doesn't crash, inserts a `⚠ file not found` placeholder in the prompt. A future agent inspecting a prompt that mentions missing files can trace back to this warning.
- `loadPrompt()` throws with an explicit missing-variable message if template placeholders and builder vars diverge — immediate failure visibility when prompt template evolves without updating the builder.
- `readAllExperiments()` silently skips malformed JSONL lines — consistent with `readBestMetrics()` resilience pattern. No noisy logging for expected corruption.
- `compressExperimentHistory()` output is human-readable in the prompt itself — serves as an inspection surface for both the LLM and a debugging agent reviewing prompt content.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — all tests pass
- `npm run build` — clean compile, no errors

## Inputs

- `src/resources/extensions/gsd/types.ts` — `CampaignConfig`, `ExperimentResult`, `ExperimentContext` interfaces
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()` to extend
- `src/resources/extensions/gsd/eval-runner.ts` — `readBestMetrics()` as pattern for JSONL reading
- `src/resources/extensions/gsd/auto.ts` — stub at lines 1308-1326, `buildResearchSlicePrompt()` as pattern, `inlineFile()` helpers
- `src/resources/extensions/gsd/prompt-loader.ts` — `loadPrompt()` for template loading
- S02 forward intelligence: ExperimentContext type, campaign config parsing, dispatch stub location
- S03 forward intelligence: JSONL is source of truth, readBestMetrics for baseline

## Expected Output

- `src/resources/extensions/gsd/prompts/run-experiment.md` — prompt template with five context sections
- `src/resources/extensions/gsd/auto.ts` — `buildExperimentPrompt()` function, stub replaced
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments()`, `compressExperimentHistory()` exports
- `src/resources/extensions/gsd/types.ts` — `researchQuestion` on `CampaignConfig`
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — contract tests
