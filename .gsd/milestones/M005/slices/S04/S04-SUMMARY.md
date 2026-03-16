---
id: S04
parent: M005
milestone: M005
provides:
  - Four hypothesis-native prompt templates (research, plan, execute, verify)
  - Four exported async builder functions for S05 dispatch wiring
  - readLatestExperimentAnalysis helper for backward-scanning experiment analysis files
  - 69-assertion contract test suite proving template/builder parity and content requirements
requires:
  - slice: S02
    provides: Karpathy auto-research analysis (simplicity criterion, NEVER STOP, tool naming, structured analysis patterns)
  - slice: S03
    provides: Scaffold structure (CAMPAIGN.json fields, PRIORS.md, slice directory layout)
affects:
  - S05 (state machine dispatch calls these builders)
  - S06 (end-to-end integration exercises prompts in real flow)
key_files:
  - src/resources/extensions/gsd/prompts/research-hypothesis.md
  - src/resources/extensions/gsd/prompts/plan-experiment.md
  - src/resources/extensions/gsd/prompts/execute-experiment.md
  - src/resources/extensions/gsd/prompts/verify-experiment.md
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts
key_decisions:
  - D087 — readLatestExperimentAnalysis scans backwards from current experiment number
  - D088 — Execute builder takes experimentPlan as explicit parameter (not read from disk)
patterns_established:
  - Hypothesis builders follow identical pattern to buildExperimentPrompt: parseCampaignConfig → target files with degradation → context files via existsSync/readFileSync → loadPrompt
  - Optional context files (PRIORS.md, HYPOTHESIS-RESEARCH.md, EXPERIMENT-NNN-ANALYSIS.md) degrade to placeholder strings, never throw
  - NEVER STOP autonomy directive in all four templates
  - Contract tests use assertContains/assertNotMatch helpers for content and naming checks
  - Naming compliance regex uses word boundaries (\bGSD\b|\blabrat\b|\bLabrat\b) to avoid false positives
observability_surfaces:
  - Builder stderr warnings on missing target files: [gsd] build*Prompt: target file not found: <path>
  - Builder throws with descriptive message when CAMPAIGN.json missing
  - loadPrompt throws listing missing {{vars}} if template/builder drift
  - Rendered prompts show visible ⚠ or placeholder text when optional context files absent
  - Test output shows exact assertion name on failure
drill_down_paths:
  - .gsd/milestones/M005/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S04/tasks/T02-SUMMARY.md
duration: 33m
verification_result: passed
completed_at: 2026-03-16
---

# S04: Hypothesis-Native Prompts

**Four research-tuned prompt templates and exported builder functions for hypothesis-driven agent phases, with 69-assertion contract test suite proving template/builder parity, content requirements, and naming compliance.**

## What Happened

Created four prompt templates grounded in S02's Karpathy auto-research analysis, replacing the single `run-experiment.md` approach with dedicated prompts for each agent phase:

**research-hypothesis.md** (~75 lines) — Research agent prompt that explicitly names `search-the-web`, `fetch_page`, `resolve_library`, `get_library_docs` tools. Requires at least 3 distinct sources. Instructs writing HYPOTHESIS-RESEARCH.md to the slice directory. Injects campaign config, priors, target files, and metric definitions.

**plan-experiment.md** (~65 lines) — Plan agent prompt for forming concrete testable hypotheses. Receives research findings (HYPOTHESIS-RESEARCH.md) and prior experiment analysis (EXPERIMENT-NNN-ANALYSIS.md). Requires what-to-change, why, expected metric movement, and refutation criteria.

**execute-experiment.md** (~85 lines) — Execute agent prompt preserving the ⛔ Safety Boundaries and 🔄 Evaluation Is Automatic sections from run-experiment.md. Adds research findings, prior analysis, and explicit experiment plan as context. Enforces one-focused-change discipline.

**verify-experiment.md** (~80 lines) — Verify agent prompt requiring structured analysis: What Worked, What Didn't Work, Signals for Next Experiment. Includes Karpathy simplicity criterion near-verbatim. Instructs writing EXPERIMENT-NNN-ANALYSIS.md.

All four templates include the NEVER STOP autonomy directive and contain zero GSD/labrat/Labrat references.

Four exported async builder functions added to auto.ts following the `buildExperimentPrompt` pattern: `buildResearchHypothesisPrompt`, `buildPlanExperimentPrompt`, `buildExecuteExperimentPrompt`, `buildVerifyExperimentPrompt`. Plus `readLatestExperimentAnalysis` helper that scans backwards for prior experiment analysis files.

Contract test suite (`hypothesis-prompt.test.ts`) with 69 assertions proves all templates load with correct vars, contain required content sections (tool names, safety boundaries, structured analysis sections, NEVER STOP), handle empty optional context gracefully, and pass naming compliance.

## Verification

- **`npx tsc --noEmit`** — compiles clean with all four exported builders ✅
- **`rg -w 'GSD|labrat|Labrat'`** on all four templates — zero hits ✅
- **`hypothesis-prompt.test.ts`** — 69 passed, 0 failed ✅
- **Failure-path check** — builders throw descriptive error on missing CAMPAIGN.json (verified manually; builders use parseCampaignConfig which returns null, triggering descriptive throw) ✅

## Requirements Advanced

- R045 (Hypothesis-Native Prompts) — All four agent phases now have research-tuned prompts. Research prompt instructs genuine deep search with named tools and minimum source count. Verify prompt requires structured analysis. Execute prompt preserves safety boundaries. Plan prompt grounds hypotheses in research findings.
- R046 (Deep Research Per Hypothesis) — Research prompt explicitly names all four search tools, requires 3+ distinct sources, prescribes a multi-step research process (understand → search broadly → read deeply → check library docs → synthesize), and forbids shallow one-search-and-done research.

## Requirements Validated

- R045 — Prompt content verified by 69 contract assertions: tool names present, safety boundaries preserved, structured analysis sections required, NEVER STOP in all templates, naming compliance clean. Builders export correctly for S05 dispatch. Template/builder var parity proven.
- R046 — Research prompt content proven by contract tests: `search-the-web`, `fetch_page`, `resolve_library`, `get_library_docs` all present; "3 distinct sources" minimum stated; multi-step research process prescribed. Runtime validation (does the agent actually follow the prompt?) deferred to S06.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Added `readLatestExperimentAnalysis` helper (not in original task plan) — needed by three builders to read EXPERIMENT-NNN-ANALYSIS.md files from prior experiments.
- `buildExecuteExperimentPrompt` takes `experimentPlan: string` as parameter (D088) — plan agent output isn't persisted to disk.
- `buildVerifyExperimentPrompt` takes `currentResults: string` as parameter — eval results are assembled by dispatch, not read from file.

## Known Limitations

- Prompts instruct research depth, but whether agents actually follow the instructions is a runtime concern validated in S06, not here.
- Failure-path testing (builder without CAMPAIGN.json) was verified manually, not as an automated test assertion. The existing `experiment-prompt.test.ts` pattern covers this for the original builder; adding it for hypothesis builders would require tmpdir scaffolding.

## Follow-ups

- S05 must wire dispatch to call these four builders at the correct phase boundaries.
- S06 must validate that the research prompt actually produces multi-source investigation at runtime (not just that it instructs it).

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/research-hypothesis.md` — Research agent prompt template (~75 lines)
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — Plan agent prompt template (~65 lines)
- `src/resources/extensions/gsd/prompts/execute-experiment.md` — Execute agent prompt template (~85 lines)
- `src/resources/extensions/gsd/prompts/verify-experiment.md` — Verify agent prompt template (~80 lines)
- `src/resources/extensions/gsd/auto.ts` — Four exported builder functions + readLatestExperimentAnalysis helper (~270 lines added)
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — Contract test file (69 assertions)

## Forward Intelligence

### What the next slice should know
- All four builder functions are exported and ready to call from S05's dispatch logic. Signatures: `buildResearchHypothesisPrompt(mid, sid, basePath)`, `buildPlanExperimentPrompt(mid, sid, basePath, experimentNumber)`, `buildExecuteExperimentPrompt(mid, sid, basePath, experimentNumber, experimentPlan)`, `buildVerifyExperimentPrompt(mid, sid, basePath, experimentNumber, currentResults)`.
- The execute builder needs the plan text passed as a parameter (D088) — it's not persisted to disk. S05 dispatch must capture the plan agent's output and feed it to the execute builder.
- The verify builder needs current results as a string parameter — S05 dispatch must assemble this from eval output.
- `readLatestExperimentAnalysis(sliceDir, currentExperimentNumber)` is available for the plan builder to inject prior analysis. It's already called internally by the plan and execute builders.

### What's fragile
- Template/builder var parity — if a template adds a `{{newVar}}`, the builder must add it too. The 69-assertion test catches this at test time, but new vars in templates without corresponding builder changes will crash loadPrompt.
- PRIORS.md, HYPOTHESIS-RESEARCH.md, and EXPERIMENT-NNN-ANALYSIS.md are read via existsSync — file permissions or encoding issues could silently degrade to placeholder text.

### Authoritative diagnostics
- `npm test -- hypothesis-prompt.test.ts` (or direct `node` invocation) — 69 assertions cover all content requirements and var parity. If this passes, the templates and builders are correct.
- `rg -w 'GSD|labrat|Labrat'` on the four template files — naming compliance gate.

### What assumptions changed
- Original plan expected four builders with simple signatures — actual implementation needed `experimentPlan` and `currentResults` as explicit parameters because these contexts live in LLM output, not on disk. This is a design improvement (D088) that keeps builders pure.
