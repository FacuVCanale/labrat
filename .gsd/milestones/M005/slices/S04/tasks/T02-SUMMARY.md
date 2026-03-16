---
id: T02
parent: S04
milestone: M005
provides:
  - Contract test file proving all 4 hypothesis-native templates load with correct builder vars
  - Content assertions verifying required sections per template
  - Edge case coverage for empty/placeholder optional context
  - Naming compliance gate (no GSD/labrat/Labrat in template text)
key_files:
  - src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts
key_decisions: []
patterns_established:
  - Contract tests use assertContains/assertNotMatch helpers for content and naming checks
  - Each template tested with full vars AND with empty/placeholder optional context
  - Naming compliance regex uses word boundaries (\bGSD\b|\blabrat\b|\bLabrat\b) to avoid false positives
observability_surfaces:
  - Test output shows exact assertion name on failure: "FAIL: <template> contains '<expected text>'"
  - loadPrompt error names the template and lists all missing {{vars}} on drift
  - Exit code 1 on any failure — CI-compatible
duration: 8m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Contract tests for template/builder variable parity

**69 contract assertions proving all 4 hypothesis-native templates load correctly, contain required content, handle empty optional context, and pass naming compliance.**

## What Happened

Created `hypothesis-prompt.test.ts` following the `experiment-prompt.test.ts` pattern (same assert helper, process.exit(1) on failure). The test covers:

1. **Template loading (4 templates):** Constructs the complete vars object matching what each builder produces, calls `loadPrompt(name, vars)`, asserts no throw. Vars extracted directly from the builder source code in auto.ts.

2. **Content assertions per template:**
   - **research-hypothesis** (13 assertions): search-the-web, fetch_page, resolve_library, get_library_docs, HYPOTHESIS-RESEARCH.md, NEVER STOP, source count "3", Campaign Overview, Target Files, Instructions, research question substitution, Prior Knowledge section, "research agent" role
   - **plan-experiment** (12 assertions): NEVER STOP, hypothesis language, Campaign Overview, Best Metrics, Experiment History, Research Findings, Prior Experiment Analysis, Instructions, "planning agent" role, refutation criteria, one-change discipline, research question substitution
   - **execute-experiment** (16 assertions): ONLY modify the target files, Do NOT run the eval command, NEVER STOP, all context sections, Safety Boundaries, Evaluation Is Automatic, eval command substitution, ONE focused change, research question substitution
   - **verify-experiment** (16 assertions): What Worked, What Didn't, Signals, simplicity criterion, EXPERIMENT- reference, NEVER STOP, all context sections, "verification agent" role, Analysis Requirements, Verification Checklist, research question substitution

3. **Edge cases (4 assertions):** All 4 templates load successfully with empty/placeholder values for optional context fields (empty priorsContext, placeholder researchFindings/priorAnalysis/experimentHistory/bestMetrics/experimentPlan).

4. **Naming compliance (4 assertions):** Regex `/\bGSD\b|\blabrat\b|\bLabrat\b/` tested against all 4 rendered template outputs — zero hits.

## Verification

- **`npm test -- hypothesis-prompt.test.ts`** — 69 passed, 0 failed, exit 0 ✅
- **`npx tsc --noEmit`** — compiles clean ✅
- **`rg -w 'GSD|labrat|Labrat'`** on all 4 template files — zero hits ✅

### Slice-level verification status (T02 is the final task):
- ✅ `npm test -- hypothesis-prompt.test.ts` — 69 assertions, all pass
- ✅ `npx tsc --noEmit` — compiles clean
- ✅ `rg -w 'GSD|labrat|Labrat'` — zero hits on all 4 templates
- ⚠️ Failure-path check (builder without CAMPAIGN.json throws descriptive error) — not added as a test assertion; verified manually via T01. The test file focuses on template/builder parity, not builder integration (builders require tmpdir scaffolding with parseCampaignConfig that's already covered in experiment-prompt.test.ts pattern).

## Diagnostics

- Run `npm test -- hypothesis-prompt.test.ts` — shows per-section pass/fail with explicit assertion names
- On failure, console shows `FAIL: <template> contains '<expected text>'` or `FAIL: <template> naming compliance — no GSD/labrat/Labrat`
- On template/builder drift, `loadPrompt` throws: `loadPrompt("<name>"): template declares {{varName}} but no value was provided`
- Exit code 1 on any failure — safe for CI gating

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — New contract test file (69 assertions across 4 templates)
- `.gsd/milestones/M005/slices/S04/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
- `.gsd/milestones/M005/slices/S04/S04-PLAN.md` — Marked T02 as done
