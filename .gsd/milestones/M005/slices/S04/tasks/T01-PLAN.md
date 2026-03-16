---
estimated_steps: 5
estimated_files: 5
---

# T01: Write four prompt templates and their builder functions

**Slice:** S04 — Hypothesis-Native Prompts
**Milestone:** M005

## Description

Create the four hypothesis-native prompt templates and their corresponding exported builder functions. This is the core deliverable of S04 — the prompts define what each agent does during hypothesis-driven research, and the builders assemble the context each agent needs. Templates are grounded in S02's Karpathy auto-research analysis.

## Steps

1. **Write `research-hypothesis.md`** — The research agent's prompt. Names tools explicitly (search-the-web, fetch_page, resolve_library, get_library_docs). Requires at least 3 distinct sources. Instructs writing HYPOTHESIS-RESEARCH.md to the slice directory. Injects campaign config, priors, target files, metric definitions. NEVER STOP directive. NightShift naming only.

2. **Write `plan-experiment.md`** — The plan agent's prompt for forming a concrete testable hypothesis. Injects research findings (from HYPOTHESIS-RESEARCH.md), prior experiment verifier analysis (from EXPERIMENT-NNN-ANALYSIS.md), target files, best metrics, experiment history. Requires: what to change, why (grounded in research), expected metric movement, refutation criteria. NEVER STOP directive.

3. **Write `execute-experiment.md`** — The execute agent's prompt for modifying target files. Similar structure to existing `run-experiment.md` but with research findings and prior analysis injected as additional context. MUST preserve safety boundaries: only modify target files, do NOT run eval. NEVER STOP directive. Karpathy's "one focused change per experiment" discipline.

4. **Write `verify-experiment.md`** — The verify agent's prompt for analyzing results and producing structured analysis. Requires output in structured markdown: `## What Worked`, `## What Didn't Work`, `## Signals for Next Experiment`. Includes Karpathy simplicity criterion near-verbatim. Instructs writing EXPERIMENT-NNN-ANALYSIS.md to slice directory. NEVER STOP directive.

5. **Write four exported builder functions in auto.ts** — `buildResearchHypothesisPrompt`, `buildPlanExperimentPrompt`, `buildExecuteExperimentPrompt`, `buildVerifyExperimentPrompt`. Each follows the `buildExperimentPrompt` pattern: reads campaign config via `parseCampaignConfig`, reads target files with degradation (⚠ placeholder on missing), reads relevant context files via `inlineFileOptional`, returns `loadPrompt(name, vars)`. Each is `export async function` so S05 can call it from dispatch.

## Must-Haves

- [ ] research-hypothesis.md names search-the-web, fetch_page, resolve_library, get_library_docs explicitly
- [ ] research-hypothesis.md requires at least 3 distinct sources
- [ ] research-hypothesis.md instructs writing HYPOTHESIS-RESEARCH.md to slice directory
- [ ] plan-experiment.md injects researchFindings and priorAnalysis context
- [ ] execute-experiment.md has ⛔ Safety Boundaries section matching run-experiment.md
- [ ] execute-experiment.md has 🔄 Evaluation Is Automatic section
- [ ] verify-experiment.md requires What Worked / What Didn't / Signals sections
- [ ] verify-experiment.md includes Karpathy simplicity criterion
- [ ] verify-experiment.md instructs writing EXPERIMENT-NNN-ANALYSIS.md
- [ ] All four templates include NEVER STOP autonomy directive
- [ ] All four builder functions are `export async function`
- [ ] No GSD, labrat, or Labrat in any template text
- [ ] `npx tsc --noEmit` compiles clean

## Verification

- `npx tsc --noEmit` — compiles with all four exported builders
- `rg -w 'GSD|labrat|Labrat' src/resources/extensions/gsd/prompts/research-hypothesis.md src/resources/extensions/gsd/prompts/plan-experiment.md src/resources/extensions/gsd/prompts/execute-experiment.md src/resources/extensions/gsd/prompts/verify-experiment.md` — zero hits
- Manual inspection: each template's `{{var}}` placeholders have matching keys in its builder's vars object

## Inputs

- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` — Karpathy analysis: simplicity criterion text, NEVER STOP directive text, tool naming pattern, structured analysis pattern, prompt fragments for all 4 phases
- `src/resources/extensions/gsd/auto.ts` lines 1963-2041 — `buildExperimentPrompt()` as canonical builder pattern
- `src/resources/extensions/gsd/prompts/run-experiment.md` — existing template structure, safety boundaries to preserve
- `src/resources/extensions/gsd/nightshift-interview.ts` — scaffold structure (CAMPAIGN.json fields, PRIORS.md location)
- `src/resources/extensions/gsd/prompt-loader.ts` — `loadPrompt` strict variable matching contract

## Expected Output

- `src/resources/extensions/gsd/prompts/research-hypothesis.md` — ~80 lines, research agent prompt with tool names, depth requirements, persistence instruction
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — ~60 lines, plan agent prompt with hypothesis formation structure
- `src/resources/extensions/gsd/prompts/execute-experiment.md` — ~80 lines, execute agent prompt with research context + safety boundaries
- `src/resources/extensions/gsd/prompts/verify-experiment.md` — ~80 lines, verify agent prompt with structured analysis requirements + simplicity criterion
- `src/resources/extensions/gsd/auto.ts` — four new exported async builder functions (~200 lines total), following existing pattern

## Observability Impact

- **New signals:** Each builder logs to stderr on target-file read failure (`[gsd] build*: target file not found: <path>`, `[gsd] build*: error reading target file <path>: <err>`). Fatal missing CAMPAIGN.json throws with slice directory path.
- **Inspection:** A future agent can verify builder health by calling `loadPrompt("<template>", vars)` — throws listing any var mismatch. The contract test (`hypothesis-prompt.test.ts`, T02) exercises this surface.
- **Failure state:** When optional files (PRIORS.md, HYPOTHESIS-RESEARCH.md, EXPERIMENT-NNN-ANALYSIS.md) are absent, the rendered prompt contains visible `⚠` or empty-string markers — not silent omissions. Downstream agents see exactly what context was unavailable.
