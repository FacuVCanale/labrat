# S04: Hypothesis-Native Prompts — Research

**Date:** 2026-03-16

## Summary

S04 must produce four prompt templates (research-hypothesis.md, plan-experiment.md, execute-experiment.md, verify-experiment.md) and their corresponding builder functions in auto.ts. These replace the single `run-experiment.md` prompt for hypothesis-driven research campaigns. The prompts are grounded in Karpathy's auto-research patterns (S02-RESEARCH.md) and consume the scaffold structure from S03.

The critical architectural constraint is that `deriveState()` currently short-circuits to `phase: 'experimenting'` when it detects CAMPAIGN.json, then `dispatchNextUnit` always dispatches `run-experiment` → `buildExperimentPrompt`. S04 writes the prompts and builders; **S05 wires them into the state machine** with new dispatch logic that cycles through research→plan→execute→verify per hypothesis/experiment. S04's builder functions must be exported so S05 can call them from the dispatch switch.

The research prompt is the core differentiator — it must instruct genuinely deep investigation using named tools (search-the-web, fetch_page, resolve_library, get_library_docs). The verify prompt must produce structured analysis in a predictable format that the plan agent can consume. Karpathy's simplicity criterion (near-verbatim from S02 adopt table) belongs in the verify prompt. The NEVER STOP directive belongs in all four prompts.

## Recommendation

Create four new `.md` prompt templates in `src/resources/extensions/gsd/prompts/` and four corresponding `build*` async functions in `auto.ts`. Follow the existing `buildExperimentPrompt` + `loadPrompt` pattern exactly. Each builder reads campaign config, target files, experiment history, and phase-specific context, then calls `loadPrompt("template-name", vars)`.

Do NOT modify the state machine dispatch logic or `deriveState` — that's S05's job. Do NOT modify the existing `run-experiment.md` or `buildExperimentPrompt` — they continue to serve non-hypothesis campaigns. The new prompts are additive.

For each prompt, define what context it needs injected and what artifact it should produce (write to disk). The persistence contracts (what gets written where) enable S05 to wire the learning loop.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Template loading & variable substitution | `loadPrompt()` in prompt-loader.ts | Enforces strict `{{var}}` matching — prevents template/builder drift |
| Campaign config parsing | `parseCampaignConfig()` in state.ts | Already validates all CampaignConfig fields including priors |
| Experiment history compression | `compressExperimentHistory()` in eval-runner.ts | Already formats JSONL entries for prompt injection |
| Best metrics reading | `readBestMetrics()` in eval-runner.ts | Already reads EXPERIMENT-LOG.jsonl and finds best per metric |
| File inlining for context | `inlineFile()` / `inlineFileOptional()` in auto.ts | Standard pattern for reading files and formatting them as context sections |
| Phase-aware context | `getPhasePromptOverrides()` in agenda.ts | Scopes history/metrics to current agenda phase |
| Steering context | `getSteeringPromptOverride()` in steering.ts | Reads STEERING-FOCUS.md for refocus directives |
| Target file reading with degradation | Pattern in `buildExperimentPrompt()` lines 1975-1991 | ⚠ placeholder on missing file instead of crash |
| Simplicity scoring | `computeSimplicityScore()` in simplicity-scorer.ts | Already computes from diff-stat, just needs prompt framing |

## Existing Code and Patterns

- `src/resources/extensions/gsd/auto.ts` lines 1963-2041 — `buildExperimentPrompt()`: the canonical builder pattern. Reads config, target files, history, metrics, phase/steering context. Returns `loadPrompt("run-experiment", vars)`. **All four new builders should follow this same structure.**
- `src/resources/extensions/gsd/auto.ts` lines 2105-2175 — `buildResearchSlicePrompt()` and `buildPlanSlicePrompt()`: the development-oriented research and plan builders. They inline roadmap, context, decisions, requirements, dependency summaries. **The hypothesis research prompt should inline CAMPAIGN.json config, PRIORS.md, and target files instead of these development artifacts.**
- `src/resources/extensions/gsd/prompt-loader.ts` — `loadPrompt(name, vars)`: reads `prompts/${name}.md`, substitutes `{{key}}` placeholders, throws on undeclared variables. Templates must have every `{{var}}` they use declared in the builder's vars object.
- `src/resources/extensions/gsd/prompts/run-experiment.md` — Current single-prompt experiment template. Five sections: Campaign Overview, Target Files, Best Metrics, Experiment History, Instructions. Safety boundaries (target file restriction, eval-is-automatic). **The execute-experiment.md should keep these safety sections.**
- `src/resources/extensions/gsd/nightshift-interview.ts` — Scaffold generator. Creates CAMPAIGN.json with `priors` field and PRIORS.md per hypothesis-slice. **Builders should read both.**
- `src/resources/extensions/gsd/eval-runner.ts` line 369 — `compressExperimentHistory()`: formats experiments as one-line-per-experiment with id, decision, metrics, description. Used by `buildExperimentPrompt` for the history section.
- `src/resources/extensions/gsd/prompts/complete-slice.md` — Verify/complete template. Uses `{{inlinedContext}}` for comprehensive context injection. **The verify-experiment prompt can follow a simpler pattern since it has focused scope (one experiment's results).**

## Constraints

- **Mustache-templated markdown** — prompts live in `src/resources/extensions/gsd/prompts/`. Every `{{var}}` in the template must have a value in the builder's vars object. `loadPrompt` throws on missing vars.
- **Fresh context per agent dispatch** — each agent gets a clean LLM context window. Research findings, verifier analysis, and hypothesis state must be persisted to disk between agents, not passed via in-memory state.
- **Builder functions must be exported** — S05 will call them from new dispatch paths in `dispatchNextUnit`. Use `export async function build*()` pattern.
- **NightShift naming only** — no GSD, labrat, or Labrat in user-facing prompt text (S01 established this, S04 must maintain it).
- **Target file safety boundaries** — execute-experiment prompt must preserve the existing safety boundaries: only modify listed target files, do NOT run eval command. These are not just prompt text; they're reinforced by programmatic `validateTargetFiles` (M002).
- **NEVER STOP directive** — from S02 Karpathy analysis: all four prompts must include autonomy language ("do NOT pause to ask the human").
- **auto.ts is 3275 lines** — keep builder functions focused. Follow D039 pattern: new features as functions within auto.ts, not new modules (builders are tightly coupled to the inline/path helpers already in auto.ts).

## Common Pitfalls

- **Shallow research theater** — The user's worst-case outcome. If the research prompt says "search for improvements" without naming tools or setting depth expectations, the agent will do one web search and declare done. The prompt MUST name the tools (search-the-web, fetch_page, resolve_library, get_library_docs) and set minimum depth expectations (e.g., "investigate at least 3 distinct approaches from different sources").
- **Research findings lost between agents** — The researcher produces knowledge in its context window, which gets wiped. Research findings MUST be written to a file on disk (e.g., `HYPOTHESIS-RESEARCH.md` in the slice directory). The plan and execute builders must inline this file. The prompt must explicitly instruct: "Write your findings to `HYPOTHESIS-RESEARCH.md`."
- **Verifier analysis as unstructured prose** — If the verify prompt just says "analyze the results," the output will be narrative prose that's hard for the planner to consume. The prompt must specify structured markdown sections: `## What Worked`, `## What Didn't Work`, `## Signals for Next Experiment`. The builder for the next experiment's plan agent must inline this file.
- **Template/builder variable mismatch** — `loadPrompt` throws on undeclared variables. Every `{{var}}` in the `.md` template must have a matching key in the builder's vars object. Test this with a prompt-loader contract test per template.
- **Priors not injected** — CAMPAIGN.json has `priors` field and PRIORS.md exists per hypothesis-slice, but `buildExperimentPrompt` currently ignores both. The new research-hypothesis builder MUST read PRIORS.md and inject it as context.
- **Overlong prompts blowing token budget** — Deep research context (HYPOTHESIS-RESEARCH.md) + full experiment history + target file sources + verifier analysis could produce very large prompts. Builders should cap history compression (already capped at 20 in `compressExperimentHistory`) and consider truncating research findings if they exceed a reasonable size.
- **Breaking existing non-hypothesis campaigns** — The existing `run-experiment.md` and `buildExperimentPrompt` must stay unchanged. New prompts are additive. S05 will add dispatch logic to route hypothesis campaigns to the new prompts while leaving vanilla campaigns on the existing path.

## Open Risks

- **Research depth vs. token budget** — Genuine deep research (multiple searches, page reads, library docs) can consume 50-80% of a unit's token budget. The prompt must guide efficient investigation without wasted exploration. No mitigation beyond careful prompt wording — the right balance is "at least 3 sources" not "at least 10."
- **Verifier analysis quality** — The verifier must produce analysis that's actually useful for the planner. If the analysis is "metrics went down, try something else," it adds no value. The prompt must require concrete reasoning: WHY metrics moved, WHAT specific aspect of the change affected them, WHAT alternative approach the analysis suggests. Quality is a UAT concern (S06), but the prompt design in S04 determines the ceiling.
- **File format for persisted artifacts** — Research findings and verifier analysis need predictable file names and locations. If the researcher writes to an unexpected path, the plan builder can't find it. The prompt must be explicit about file paths. Proposed convention:
  - Research findings: `HYPOTHESIS-RESEARCH.md` in the slice directory
  - Verifier analysis per experiment: `EXPERIMENT-NNN-ANALYSIS.md` in the slice directory (NNN = zero-padded experiment number)
  - These paths must be both in the prompt (telling the agent where to write) and in the builder (telling the code where to read).
- **Four builders + four templates = 8 files with tight coupling** — Any variable name mismatch between template and builder causes a runtime throw. Contract tests for each template (like the existing `experiment-prompt.test.ts`) are essential but add test surface.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Prompt engineering for research agents | (no specific skill) | none found — this is domain-specific prompt design |
| Mustache templating | (built-in to prompt-loader.ts) | already in codebase |
| Karpathy autoresearch patterns | (analyzed in S02-RESEARCH.md) | consumed as research artifact |

No skills were installed. The work is prompt design and TypeScript builder functions within the existing codebase — no external libraries or frameworks involved.

## Sources

- Karpathy auto-research prompt patterns, simplicity criterion, NEVER STOP directive, experiment loop mechanics (source: `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md`)
- Existing experiment prompt structure and builder pattern (source: `src/resources/extensions/gsd/auto.ts` lines 1963-2041, `src/resources/extensions/gsd/prompts/run-experiment.md`)
- Scaffold structure producing CAMPAIGN.json, PRIORS.md per hypothesis-slice (source: `src/resources/extensions/gsd/nightshift-interview.ts`)
- Template loader with strict variable matching (source: `src/resources/extensions/gsd/prompt-loader.ts`)
- State machine campaign detection short-circuiting to experimenting phase (source: `src/resources/extensions/gsd/state.ts` lines 462-512)
- Existing contract tests for experiment prompt building (source: `src/resources/extensions/gsd/tests/experiment-prompt.test.ts`)
- Development-oriented research/plan/complete prompt templates (source: `src/resources/extensions/gsd/prompts/research-slice.md`, `plan-slice.md`, `complete-slice.md`)
