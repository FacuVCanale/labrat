---
estimated_steps: 3
estimated_files: 1
---

# T02: Contract tests for template/builder variable parity

**Slice:** S04 — Hypothesis-Native Prompts
**Milestone:** M005

## Description

Create contract tests that prove each of the four new prompt templates loads correctly with its builder's variable set. `loadPrompt` throws on undeclared `{{var}}` placeholders — these tests catch template/builder drift before runtime. Also verifies prompt content requirements and NightShift naming compliance.

## Steps

1. **Create `hypothesis-prompt.test.ts`** following the `experiment-prompt.test.ts` pattern (same assert helper, tmpdir fixtures, process.exit on failure). For each of the 4 templates (research-hypothesis, plan-experiment, execute-experiment, verify-experiment): construct the complete vars object matching what the builder would produce, call `loadPrompt(name, vars)`, assert no throw.

2. **Content assertions per template** — After loading each template:
   - research-hypothesis: contains "search-the-web", "fetch_page", "resolve_library", "get_library_docs", "HYPOTHESIS-RESEARCH.md", "NEVER STOP" or equivalent autonomy directive, "3" (source count)
   - plan-experiment: contains hypothesis formation language, "NEVER STOP" or equivalent
   - execute-experiment: contains "ONLY modify the target files", "Do NOT run the eval command", "NEVER STOP" or equivalent
   - verify-experiment: contains "What Worked", "What Didn't", "Signals", simplicity criterion language, "EXPERIMENT-", "NEVER STOP" or equivalent

3. **Edge cases and naming compliance** — Test templates load with empty/placeholder values for optional context (no research findings, no prior analysis, no priors, no experiment history). Run naming compliance: grep all 4 template contents for GSD/labrat/Labrat — assert zero hits.

## Must-Haves

- [ ] All 4 templates load via loadPrompt without throwing
- [ ] Content assertions verify required sections per template
- [ ] Edge case: templates load with empty optional context
- [ ] Naming compliance: zero GSD/labrat/Labrat matches across all 4 templates
- [ ] Test exits with code 1 on any failure

## Verification

- `npm test -- hypothesis-prompt.test.ts` — all assertions pass, exit 0

## Inputs

- `src/resources/extensions/gsd/prompts/research-hypothesis.md` — template from T01
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — template from T01
- `src/resources/extensions/gsd/prompts/execute-experiment.md` — template from T01
- `src/resources/extensions/gsd/prompts/verify-experiment.md` — template from T01
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — pattern to follow for test structure

## Expected Output

- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — contract test file with ~60+ assertions covering all 4 templates, edge cases, and naming compliance

## Observability Impact

- **Template/builder drift detection:** When a template adds a new `{{var}}` placeholder without a corresponding builder update, the test fails with `loadPrompt("template-name"): template declares {{varName}} but no value was provided` — names the exact template and missing var(s).
- **Content regression detection:** If a required section (e.g. "NEVER STOP", "ONLY modify the target files") is removed from a template, the test fails with `FAIL: <template> contains '<expected text>'` — identifies which template and which content drifted.
- **Naming compliance gate:** If any template introduces GSD/labrat/Labrat in user-facing text, the test fails with `FAIL: <template> naming compliance — no GSD/labrat/Labrat` — prevents internal naming leaks.
- **Edge case visibility:** Empty/placeholder optional context values are tested — ensures builders degrade gracefully when PRIORS.md, HYPOTHESIS-RESEARCH.md, or EXPERIMENT-NNN-ANALYSIS.md are absent.
- **CI signal:** `npm test -- hypothesis-prompt.test.ts` runs as part of the standard test suite. Exit code 1 on any failure. Console output shows `✅ N passed, ❌ M failed` summary.
