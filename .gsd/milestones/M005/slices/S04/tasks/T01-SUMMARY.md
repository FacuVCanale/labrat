---
id: T01
parent: S04
milestone: M005
provides:
  - Four hypothesis-native prompt templates (research, plan, execute, verify)
  - Four exported async builder functions for S05 dispatch wiring
  - readLatestExperimentAnalysis helper for backward-scanning experiment analysis files
key_files:
  - src/resources/extensions/gsd/prompts/research-hypothesis.md
  - src/resources/extensions/gsd/prompts/plan-experiment.md
  - src/resources/extensions/gsd/prompts/execute-experiment.md
  - src/resources/extensions/gsd/prompts/verify-experiment.md
  - src/resources/extensions/gsd/auto.ts
key_decisions:
  - D087 — readLatestExperimentAnalysis scans backwards from current experiment number
  - D088 — Execute builder takes experimentPlan as explicit parameter (not read from disk)
patterns_established:
  - Hypothesis builders follow identical pattern to buildExperimentPrompt: parseCampaignConfig → target files with degradation → context files via existsSync/readFileSync → loadPrompt
  - Optional context files (PRIORS.md, HYPOTHESIS-RESEARCH.md, EXPERIMENT-NNN-ANALYSIS.md) degrade to placeholder strings, never throw
  - NEVER STOP autonomy directive in all four templates
observability_surfaces:
  - Builder stderr warnings on missing target files: [gsd] build*Prompt: target file not found: <path>
  - Builder throws with descriptive message when CAMPAIGN.json missing
  - loadPrompt throws listing missing {{vars}} if template/builder drift
  - Rendered prompts show visible ⚠ or placeholder text when optional context files absent
duration: 25m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Write four prompt templates and their builder functions

**Four hypothesis-native prompt templates and their exported builder functions added to auto.ts, following the buildExperimentPrompt pattern.**

## What Happened

Created four prompt templates grounded in S02's Karpathy auto-research analysis:

1. **research-hypothesis.md** (~75 lines) — Research agent prompt that explicitly names `search-the-web`, `fetch_page`, `resolve_library`, `get_library_docs` tools. Requires at least 3 distinct sources. Instructs writing HYPOTHESIS-RESEARCH.md to slice directory. Injects campaign config, priors, target files, metric definitions.

2. **plan-experiment.md** (~65 lines) — Plan agent prompt for concrete testable hypothesis formation. Injects research findings (HYPOTHESIS-RESEARCH.md) and prior experiment analysis (EXPERIMENT-NNN-ANALYSIS.md). Requires what-to-change, why, expected metric movement, and refutation criteria.

3. **execute-experiment.md** (~85 lines) — Execute agent prompt for modifying target files. Preserves ⛔ Safety Boundaries and 🔄 Evaluation Is Automatic sections from run-experiment.md. Adds research findings, prior analysis, and explicit experiment plan as context. Enforces one-focused-change discipline.

4. **verify-experiment.md** (~80 lines) — Verify agent prompt requiring structured analysis: What Worked, What Didn't Work, Signals for Next Experiment. Includes Karpathy simplicity criterion near-verbatim. Instructs writing EXPERIMENT-NNN-ANALYSIS.md to slice directory.

All four templates include the NEVER STOP autonomy directive. No GSD/labrat/Labrat in any template text.

Four exported async builder functions added to auto.ts:
- `buildResearchHypothesisPrompt(mid, sid, basePath)`
- `buildPlanExperimentPrompt(mid, sid, basePath, experimentNumber)`
- `buildExecuteExperimentPrompt(mid, sid, basePath, experimentNumber, experimentPlan)`
- `buildVerifyExperimentPrompt(mid, sid, basePath, experimentNumber, currentResults)`

Plus a `readLatestExperimentAnalysis(sliceDir, currentExperimentNumber)` helper that scans backwards for EXPERIMENT-NNN-ANALYSIS.md files.

## Verification

- **`npx tsc --noEmit`** — compiles clean with all four exported builders ✅
- **`rg -w 'GSD|labrat|Labrat'`** on all four template files — zero hits ✅
- **Template/builder var parity** — manually verified all `{{var}}` placeholders in each template have matching keys in their builder's vars object ✅
- **Must-haves checklist** — all 13 must-haves verified via grep checks ✅

### Slice-level verification status (T01 is intermediate):
- ✅ `npx tsc --noEmit` — passes
- ✅ `rg -w 'GSD|labrat|Labrat'` — zero hits
- ⏳ `npm test -- hypothesis-prompt.test.ts` — test file not yet created (T02 scope)

## Diagnostics

- Run `npx tsc --noEmit` to verify builder compilation
- Run `rg -w 'GSD|labrat|Labrat' src/resources/extensions/gsd/prompts/{research-hypothesis,plan-experiment,execute-experiment,verify-experiment}.md` for naming compliance
- Each builder throws descriptive errors on missing CAMPAIGN.json — check stderr for `[gsd] build*Prompt:` messages
- Template/builder var drift caught by `loadPrompt` throwing with explicit missing-var list

## Deviations

- Added `readLatestExperimentAnalysis` as a private helper in auto.ts (not in task plan but needed by three of the four builders to read EXPERIMENT-NNN-ANALYSIS.md)
- `buildExecuteExperimentPrompt` takes `experimentPlan: string` as a parameter (plan agent output isn't persisted to disk — D088)
- `buildVerifyExperimentPrompt` takes `currentResults: string` as a parameter (eval results are assembled by the dispatch layer, not read from a file)

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/research-hypothesis.md` — New research agent prompt template (75 lines)
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — New plan agent prompt template (65 lines)
- `src/resources/extensions/gsd/prompts/execute-experiment.md` — New execute agent prompt template (85 lines)
- `src/resources/extensions/gsd/prompts/verify-experiment.md` — New verify agent prompt template (80 lines)
- `src/resources/extensions/gsd/auto.ts` — Four exported builder functions + readLatestExperimentAnalysis helper (~270 lines added)
- `.gsd/milestones/M005/slices/S04/S04-PLAN.md` — Added Observability / Diagnostics section
- `.gsd/milestones/M005/slices/S04/tasks/T01-PLAN.md` — Added Observability Impact section
- `.gsd/DECISIONS.md` — Added D087, D088
