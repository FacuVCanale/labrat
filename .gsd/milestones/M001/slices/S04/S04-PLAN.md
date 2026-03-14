# S04: Research Prompts & Fresh Context

**Goal:** LLM receives an experiment-oriented prompt with target file source, compressed history, best metrics, and research question — fresh context per experiment. Replace the 12-line stub in auto.ts dispatch with a real prompt builder.
**Demo:** `buildExperimentPrompt()` produces a prompt that includes all five context sections (campaign overview, target files, best metrics, history, instructions). Contract tests verify prompt assembly, history compression, and edge cases.

## Must-Haves

- Prompt template `prompts/run-experiment.md` with `{{variable}}` placeholders matching the existing `loadPrompt()` pattern
- `buildExperimentPrompt()` in auto.ts that assembles context from campaign config, target files, experiment history, and best metrics
- `readAllExperiments()` helper in eval-runner.ts to read JSONL entries for history
- `compressExperimentHistory()` helper that produces concise one-liner summaries per experiment (id, decision, key metrics, diff indicator)
- `researchQuestion` optional field on `CampaignConfig` (falls back to `config.name`)
- Stub in auto.ts dispatch (lines 1315-1326) replaced with `buildExperimentPrompt()` call
- `ExperimentResult.description` populated with diff-stat summary instead of hardcoded `'eval post-process'`
- Prompt explicitly tells LLM NOT to run eval (post-processing handles it)
- Prompt enforces target file safety boundary (D006)
- History capped at last 20 experiments, newest-first
- Contract tests covering prompt assembly, history compression, edge cases (no history, missing target files, no best metrics)

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — contract tests for `buildExperimentPrompt()`, `readAllExperiments()`, `compressExperimentHistory()`, template loading, edge cases
- `npm run build` — clean compile with all changes
- Diagnostic: `buildExperimentPrompt()` with a missing target file produces a prompt containing a warning placeholder instead of crashing (tested in contract tests via the "missing target files" edge case)

## Observability / Diagnostics

- Runtime signals: prompt builder logs warning to stderr if a target file is unreadable (doesn't crash — inserts a placeholder in prompt)
- Inspection surfaces: `grep -n 'buildExperimentPrompt' auto.ts` shows the dispatch wiring; prompt template is inspectable at `prompts/run-experiment.md`
- Failure visibility: `loadPrompt()` throws with explicit missing-variable message if template and builder vars diverge
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `parseCampaignConfig()` from state.ts, `readBestMetrics()` from eval-runner.ts, `inlineFile()`/`inlineFileOptional()` from auto.ts, `loadPrompt()` from prompt-loader.ts, `ExperimentResult`/`CampaignConfig`/`ExperimentContext` from types.ts
- New wiring introduced in this slice: `buildExperimentPrompt()` replaces the stub in `dispatchNextUnit` experimenting branch; `readAllExperiments()` added to eval-runner.ts; `compressExperimentHistory()` added to eval-runner.ts
- What remains before the milestone is truly usable end-to-end: S05 (crash recovery, experiment log supervision), S06 (MLOps integration), S07 (CLI, morning report, smoke test)

## Tasks

- [x] **T01: Build experiment prompt template, builder, and history helpers** `est:45m`
  - Why: Core deliverable — replaces the stub prompt with real context assembly. Covers R005 and R014.
  - Files: `src/resources/extensions/gsd/prompts/run-experiment.md`, `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/experiment-prompt.test.ts`
  - Do: (1) Add optional `researchQuestion` to `CampaignConfig` in types.ts, update `parseCampaignConfig` validation to allow it. (2) Add `readAllExperiments(sliceDir)` to eval-runner.ts — reads JSONL, returns `ExperimentResult[]`. (3) Add `compressExperimentHistory(experiments, cap)` to eval-runner.ts — produces one-liner summaries, newest-first, capped. (4) Create `prompts/run-experiment.md` template with five sections: campaign overview, target files, best metrics, compressed history, instructions. Include safety boundary and eval-is-automatic directives. (5) Add `buildExperimentPrompt()` in auto.ts following the `buildResearchSlicePrompt()` pattern — reads campaign config, target files, history, best metrics, calls `loadPrompt()`. (6) Replace the stub prompt in dispatch (lines 1315-1326) with `buildExperimentPrompt()` call. (7) Write contract tests covering: prompt contains all sections, history compression format, edge cases (no history, missing files, no best metrics, empty campaign).
  - Verify: `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` passes, `npm run build` clean
  - Done when: `buildExperimentPrompt()` produces a prompt with all five context sections and the stub is replaced

- [x] **T02: Improve ExperimentResult description with diff-stat summary** `est:20m`
  - Why: Supporting change — makes experiment history meaningful. Without this, every experiment's description is `'eval post-process'` and history compression has no change context.
  - Files: `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/tests/eval-runner.test.ts`
  - Do: (1) In `runExperimentPostProcess()`, after the keep/discard decision, extract a diff-stat summary from git (`git diff --stat <parent>..<hash>`) and set `result.description` to a concise summary (e.g., `"train.py: +5/-3 (lr schedule)"` from the diff stat, or commit subject line). Fall back to `'eval post-process'` if git diff fails. (2) Update existing eval-runner tests to verify description is populated from diff stat when available. (3) Verify `npm run build` and all eval-runner tests pass.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` passes, `npm run build` clean
  - Done when: `ExperimentResult.description` contains a diff-stat summary for experiments with commits, not the hardcoded `'eval post-process'`

## Files Likely Touched

- `src/resources/extensions/gsd/prompts/run-experiment.md`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/eval-runner.ts`
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/state.ts`
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts`
- `src/resources/extensions/gsd/tests/eval-runner.test.ts`
