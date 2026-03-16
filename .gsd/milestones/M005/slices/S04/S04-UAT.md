# S04: Hypothesis-Native Prompts — UAT

**Milestone:** M005
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S04 produces prompt templates and builder functions — static artifacts verified by loading them and inspecting content. Runtime behavior (does the agent follow the prompt?) is S06's concern, not S04's.

## Preconditions

- Repository built: `npm run build` succeeds
- TypeScript compiles: `npx tsc --noEmit` clean
- Node.js with `--experimental-transform-types` available
- S02 research artifact exists at `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md`

## Smoke Test

Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-transform-types src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts`

**Expected:** "69 passed, 0 failed" — all templates load, content correct, naming clean.

## Test Cases

### 1. Research prompt names all four search tools

1. Open `src/resources/extensions/gsd/prompts/research-hypothesis.md`
2. Search for `search-the-web`, `fetch_page`, `resolve_library`, `get_library_docs`
3. **Expected:** All four tool names appear in the template text, each with a description of how to use it.

### 2. Research prompt requires minimum 3 sources

1. Open `src/resources/extensions/gsd/prompts/research-hypothesis.md`
2. Search for "3 distinct sources" or "at least 3"
3. **Expected:** Explicit instruction requiring minimum 3 distinct sources. Not a suggestion — a requirement.

### 3. Research prompt instructs writing HYPOTHESIS-RESEARCH.md

1. Open `src/resources/extensions/gsd/prompts/research-hypothesis.md`
2. Search for `HYPOTHESIS-RESEARCH.md`
3. **Expected:** Instruction to write findings to `{{sliceDir}}/HYPOTHESIS-RESEARCH.md` with a structured template (Sources Consulted, Key Findings, Promising Approaches, Risks and Considerations).

### 4. Verify prompt requires structured analysis sections

1. Open `src/resources/extensions/gsd/prompts/verify-experiment.md`
2. Search for "What Worked", "What Didn't", "Signals for Next Experiment"
3. **Expected:** All three sections appear in the output template. An explicit statement that all three are required ("not just 'nothing' or 'N/A'").

### 5. Verify prompt includes Karpathy simplicity criterion

1. Open `src/resources/extensions/gsd/prompts/verify-experiment.md`
2. Search for "simplicity" or "simpler is better"
3. **Expected:** Simplicity criterion with concrete examples: marginal improvement + complexity = not worth it; same metrics + simpler code = keep.

### 6. Execute prompt preserves safety boundaries

1. Open `src/resources/extensions/gsd/prompts/execute-experiment.md`
2. Search for "ONLY modify the target files" and "Do NOT run the eval command"
3. **Expected:** Both safety boundary directives present, preserving the D006 target-file-only constraint from run-experiment.md.

### 7. All four templates include NEVER STOP

1. Run: `grep -l 'NEVER STOP' src/resources/extensions/gsd/prompts/{research-hypothesis,plan-experiment,execute-experiment,verify-experiment}.md`
2. **Expected:** All four files listed.

### 8. Naming compliance — no GSD/labrat/Labrat

1. Run: `rg -w 'GSD|labrat|Labrat' src/resources/extensions/gsd/prompts/{research-hypothesis,plan-experiment,execute-experiment,verify-experiment}.md`
2. **Expected:** Zero matches (exit code 1 = no results).

### 9. All four builders exported from auto.ts

1. Run: `grep -E 'export async function build(ResearchHypothesis|PlanExperiment|ExecuteExperiment|VerifyExperiment)Prompt' src/resources/extensions/gsd/auto.ts`
2. **Expected:** Four matches, one for each builder function.

### 10. Builders compile with correct types

1. Run: `npx tsc --noEmit`
2. **Expected:** Clean exit (no type errors).

### 11. Template/builder variable parity

1. For each template, extract all `{{varName}}` placeholders
2. Check that the corresponding builder function provides all of them in its vars object
3. Run the contract tests: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-transform-types src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts`
4. **Expected:** 69 passed, 0 failed. loadPrompt does not throw for any template.

### 12. Plan prompt receives research findings and prior analysis

1. Open `src/resources/extensions/gsd/prompts/plan-experiment.md`
2. Search for `{{researchFindings}}` and `{{priorAnalysis}}`
3. **Expected:** Both variables present in context sections, providing the planning agent with research knowledge and prior experiment signals.

## Edge Cases

### Empty optional context

1. Run contract tests — the "Edge cases: empty optional context" section tests all four templates with empty/placeholder values for optional fields (priorsContext, researchFindings, priorAnalysis, experimentHistory, bestMetrics, experimentPlan).
2. **Expected:** All four templates load successfully. No throws. The rendered text contains the placeholder/empty values where optional context would normally appear.

### No prior experiments (first experiment in hypothesis)

1. Call `buildPlanExperimentPrompt` with experimentNumber=1 (no EXPERIMENT-000-ANALYSIS.md exists)
2. **Expected:** priorAnalysis defaults to a placeholder string (e.g., "No prior experiments"). Template loads successfully.

### Missing CAMPAIGN.json

1. Call any builder with a basePath that has no CAMPAIGN.json in the expected slice directory
2. **Expected:** Builder throws with a descriptive error message containing the slice directory path, not a generic null pointer or undefined error.

## Failure Signals

- `loadPrompt` throws with "template declares {{varName}} but no value was provided" — indicates template/builder drift
- `npx tsc --noEmit` reports type errors on builder signatures — indicates auto.ts export issues
- `rg -w 'GSD|labrat|Labrat'` returns matches — naming compliance violation
- Contract tests report "FAIL: <template> contains '<expected text>'" — content requirement missing from template
- Contract tests report "FAIL: <template> naming compliance" — forbidden terms in rendered output

## Requirements Proved By This UAT

- R045 (Hypothesis-Native Prompts) — All four agent phases have research-tuned prompts with correct content, exported builders, and naming compliance.
- R046 (Deep Research Per Hypothesis) — Research prompt instructs genuine deep search with named tools and minimum source requirements. (Runtime validation deferred to S06.)

## Not Proven By This UAT

- Whether agents actually follow the research prompt instructions at runtime (S06 concern)
- Whether the verify analysis feeds correctly into the next experiment's plan (S05 dispatch wiring)
- Whether the state machine correctly cycles through hypothesis→experiment phases (S05)
- End-to-end hypothesis flow (S06)

## Notes for Tester

- The contract tests are the primary verification mechanism. If `hypothesis-prompt.test.ts` passes (69 assertions), the templates and builders are correct.
- The test file runs as a standalone script, not via the `--test` runner. It uses `process.exit(1)` on failure.
- Template content was designed based on S02's Karpathy analysis. The S02-RESEARCH.md artifact at `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` documents the source patterns.
- The execute prompt's safety boundaries mirror `run-experiment.md` — if those were ever updated, `execute-experiment.md` should be updated to match.
