# S04: Hypothesis-Native Prompts

**Goal:** Each agent phase (research, plan, execute, verify) has a prompt template tuned for hypothesis-driven research, with corresponding exported builder functions that S05 can call from dispatch.
**Demo:** Four `.md` prompt templates load without error via `loadPrompt` with their builder's vars. Research prompt names tools and sets depth expectations. Verify prompt requires structured analysis. All prompts include NEVER STOP directive. No GSD/labrat in user-facing text.

## Must-Haves

- `research-hypothesis.md` instructs genuine deep search — names tools (search-the-web, fetch_page, resolve_library, get_library_docs), requires at least 3 distinct sources, writes HYPOTHESIS-RESEARCH.md to disk
- `plan-experiment.md` forms concrete testable hypothesis grounded in research findings and prior experiment analysis
- `execute-experiment.md` preserves target-file-only and eval-is-automatic safety boundaries from run-experiment.md
- `verify-experiment.md` requires structured analysis (What Worked / What Didn't / Signals for Next Experiment) and includes Karpathy simplicity criterion
- All four prompts include NEVER STOP autonomy directive
- All four builder functions are exported from auto.ts for S05 dispatch wiring
- Builders follow the existing `buildExperimentPrompt` + `loadPrompt` pattern
- Builders inject PRIORS.md, HYPOTHESIS-RESEARCH.md, and EXPERIMENT-NNN-ANALYSIS.md where appropriate
- No GSD, labrat, or Labrat in user-facing prompt text
- Contract tests prove each template loads with its builder's vars without throwing

## Proof Level

- This slice proves: contract (template/builder parity, prompt content inspection)
- Real runtime required: no (prompt loading is synchronous file read + string substitution)
- Human/UAT required: no (research depth is a UAT concern for S06, but S04 verifies the prompt *instructs* depth)

## Observability / Diagnostics

- **Builder errors:** Each builder throws with a descriptive message when CAMPAIGN.json is missing — same pattern as `buildExperimentPrompt`. Error message includes the slice directory path for quick diagnosis.
- **Template load failures:** `loadPrompt` throws listing which `{{vars}}` are missing when a builder doesn't supply all required variables. The error names both the template and the missing keys — a future agent or developer sees exactly what drifted.
- **Naming compliance:** `rg -w 'GSD|labrat|Labrat'` on the four template files returns zero hits. This is a CI-time and pre-commit diagnostic.
- **Inline degradation:** When optional context files (PRIORS.md, HYPOTHESIS-RESEARCH.md, EXPERIMENT-NNN-ANALYSIS.md) don't exist, the builder substitutes an empty string or a `⚠` placeholder — the prompt still loads, and the rendered text visibly signals what's absent.
- **Failure path visibility:** If `parseCampaignConfig` returns null, all four builders throw immediately with `[gsd] build*: no valid CAMPAIGN.json in <dir>` — logged to stderr and surfaced in the agent's error context.

## Verification

- `npm test -- hypothesis-prompt.test.ts` — contract tests proving each template loads with correct vars, all four prompts contain required sections, naming compliance
- `npx tsc --noEmit` — compiles clean with exported builders
- `rg -w 'GSD|labrat|Labrat' src/resources/extensions/gsd/prompts/research-hypothesis.md src/resources/extensions/gsd/prompts/plan-experiment.md src/resources/extensions/gsd/prompts/execute-experiment.md src/resources/extensions/gsd/prompts/verify-experiment.md` — zero hits
- **Failure-path check:** Contract test verifies that calling a builder without CAMPAIGN.json throws a descriptive error (not a generic crash)

## Integration Closure

- Upstream surfaces consumed: `buildExperimentPrompt` pattern (auto.ts), `loadPrompt` (prompt-loader.ts), `parseCampaignConfig` (state.ts), `compressExperimentHistory`/`readBestMetrics`/`readAllExperiments` (eval-runner.ts), `getPhasePromptOverrides` (agenda.ts), `getSteeringPromptOverride` (steering.ts), CAMPAIGN.json + PRIORS.md from S03 scaffold
- New wiring introduced in this slice: four exported builder functions and four prompt templates — no dispatch changes (S05's job)
- What remains before the milestone is truly usable end-to-end: S05 (state machine wiring to call these builders), S06 (integration proof)

## Tasks

- [x] **T01: Write four prompt templates and their builder functions** `est:45m`
  - Why: Core S04 deliverable — the prompts ARE the product. Templates define what each agent does; builders assemble the context each template needs.
  - Files: `src/resources/extensions/gsd/prompts/research-hypothesis.md`, `src/resources/extensions/gsd/prompts/plan-experiment.md`, `src/resources/extensions/gsd/prompts/execute-experiment.md`, `src/resources/extensions/gsd/prompts/verify-experiment.md`, `src/resources/extensions/gsd/auto.ts`
  - Do: Write 4 `.md` templates grounded in S02 Karpathy analysis (simplicity criterion, NEVER STOP, tool naming, structured analysis). Write 4 exported `build*` async functions in auto.ts following the `buildExperimentPrompt` pattern — each reads campaign config, target files, relevant context, and returns `loadPrompt(templateName, vars)`. Research builder injects PRIORS.md and instructs writing HYPOTHESIS-RESEARCH.md. Verify builder instructs writing EXPERIMENT-NNN-ANALYSIS.md. Execute builder preserves safety boundaries. All builders export for S05.
  - Verify: `npx tsc --noEmit` compiles clean; manual inspection that each template's `{{vars}}` match its builder
  - Done when: 4 templates exist in prompts/, 4 exported builder functions in auto.ts, TypeScript compiles

- [x] **T02: Contract tests for template/builder variable parity** `est:25m`
  - Why: `loadPrompt` throws on missing vars — contract tests catch template/builder drift before runtime. Also verifies prompt content requirements (tool names, safety boundaries, structured analysis sections, NEVER STOP, naming compliance).
  - Files: `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts`
  - Do: Create contract test file following experiment-prompt.test.ts pattern. For each of the 4 templates: construct valid vars matching what the builder would produce, call `loadPrompt(name, vars)`, assert no throw, assert required content sections present. Verify naming compliance across all 4 templates. Test edge cases (no prior experiments, no research findings, no priors).
  - Verify: `npm test -- hypothesis-prompt.test.ts` — all pass
  - Done when: All 4 templates load without error, required content verified, naming compliance clean, edge cases covered

## Files Likely Touched

- `src/resources/extensions/gsd/prompts/research-hypothesis.md`
- `src/resources/extensions/gsd/prompts/plan-experiment.md`
- `src/resources/extensions/gsd/prompts/execute-experiment.md`
- `src/resources/extensions/gsd/prompts/verify-experiment.md`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts`
