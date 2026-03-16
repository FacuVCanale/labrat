---
status: in_progress
---

# S03: /nightshift Interview & Scaffold

**Goal:** `/nightshift` command collects research parameters via programmatic wizard, generates GSD scaffold with hypothesis-slices and experiment-tasks, and offers to start auto-mode.
**Demo:** User runs `/nightshift`, answers 6 prompts (targets, eval, metrics, priors, hypothesis count, tries count), gets parseable scaffold with N hypothesis-slices each containing M experiment-tasks and CAMPAIGN.json. `/nightshift auto` launches auto-mode.

## Must-Haves

- `/nightshift` registered as an interactive command alongside `/gsd`
- Interview collects: target files, eval command, metrics (name+direction+weight loop), optional priors, hypothesis count, experiments per hypothesis
- Escape at any prompt cancels the interview gracefully (no crash)
- Generated roadmap parses via `parseRoadmapSlices()` — lines match `/^\s*-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/`
- Generated plan parses via `parsePlan()` — task lines match `/^-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/`
- Generated CAMPAIGN.json passes `parseCampaignConfig()` validation per slice
- Each hypothesis-slice gets its own CAMPAIGN.json with `maxExperiments` = tries per hypothesis
- All user-facing text says NightShift (per S01/D077)
- `/nightshift auto` routes to `startAuto()`
- `CampaignConfig` type extended with optional `priors` field
- PRIORS.md written per hypothesis-slice when priors are provided
- Git bootstrap (init if needed) and scaffold committed

## Proof Level

- This slice proves: contract (scaffold roundtrips through existing parsers)
- Real runtime required: no (pure function scaffold generator + parser roundtrip tests)
- Human/UAT required: no

## Verification

- `npm test -- --test-name-pattern nightshift-interview` — contract tests pass: scaffold roundtrips through parseRoadmapSlices, parsePlan, parseCampaignConfig
- `npm run build` — compiles clean
- `npm test` — all existing tests still pass (no regressions)
- `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts` — zero hits (NightShift naming)
- Failure path: contract test verifies that scaffold with 10+ hypotheses produces correctly padded IDs (S10, S11) and that CAMPAIGN.json with missing required fields returns null from `parseCampaignConfig`

## Observability / Diagnostics

- **Scaffold validation at generation time:** `generateNightShiftScaffold` returns silently on success; any `fs.mkdirSync`/`writeFileSync` failure propagates as a thrown error surfaced by the interview flow via `ctx.ui.notify()`.
- **Parser roundtrip:** Contract tests prove scaffold output parses via `parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig` — silent null/empty returns from parsers indicate format drift.
- **Interview cancellation:** Each `ctx.ui.input()`/`ctx.ui.select()` null return triggers `ctx.ui.notify("NightShift interview cancelled", "warning")` and early return — visible in the TUI notification area.
- **Naming compliance:** `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts` returns zero hits — any hit is a naming violation.
- **Build verification:** `npm run build` exit code 0 confirms type-safety; non-zero surfaces compile errors.
- **Failure-path verification:** Test that scaffold generator handles edge cases (0 hypotheses → minimum 1, empty metrics → validation error) without silent corruption.

## Integration Closure

- Upstream surfaces consumed: `parseRoadmapSlices()` (roadmap-slices.ts), `parsePlan()` (files.ts), `parseCampaignConfig()` (state.ts), `showNextAction()` (shared/next-action-ui.ts), `startAuto()` (auto.ts), `ctx.ui.input()`/`ctx.ui.select()` (commands.ts pattern)
- New wiring introduced in this slice: `/nightshift` command registration in commands.ts, import in index.ts
- What remains before the milestone is truly usable end-to-end: S04 (hypothesis-native prompts), S05 (learning loop), S06 (integration)

## Tasks

- [x] **T01: Implement interview wizard, scaffold generator, and command wiring** `est:60m`
  - Why: Core feature — the interview flow and scaffold generator are the entire deliverable for R044
  - Files: `src/resources/extensions/gsd/nightshift-interview.ts` (new), `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/gsd/types.ts`
  - Do: Create `nightshift-interview.ts` with `showNightShiftInterview(ctx, pi, basePath)` (programmatic wizard using ctx.ui.input/select following handlePrefsWizard pattern) and `generateNightShiftScaffold(basePath, config)` (pure function producing roadmap, plan, CAMPAIGN.json, optional PRIORS.md). Scaffold format must match parser regexes exactly — roadmap slice lines: `- [ ] **S0N: Hypothesis N** \`risk:medium\` \`depends:[]\``, plan task lines: `- [ ] **T0N: Experiment N** \`est:15m\``. Register `/nightshift` command in commands.ts routing bare to interview and `auto` to startAuto. Add import in index.ts. Add optional `priors?: string` to CampaignConfig in types.ts. Interview handles Escape (null return) as cancellation. Git init + commit scaffold. Offer to start auto-mode via showNextAction after scaffolding.
  - Verify: `npm run build` compiles clean, `/nightshift` appears in command registration
  - Done when: `nightshift-interview.ts` exists with exported `showNightShiftInterview` and `generateNightShiftScaffold`, command is registered, types extended, build passes

- [x] **T02: Contract tests proving scaffold parses correctly** `est:30m`
  - Why: The scaffold format is the critical contract — generated output must roundtrip through parseRoadmapSlices, parsePlan, and parseCampaignConfig without silent failures
  - Files: `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` (new)
  - Do: Write contract tests exercising `generateNightShiftScaffold` output against all three parsers. Test cases: (1) basic scaffold with 3 hypotheses × 5 experiments — roadmap parses all slices, plan parses all tasks per slice, CAMPAIGN.json validates; (2) single hypothesis edge case; (3) 10+ hypotheses with S10+ ID padding; (4) priors present → PRIORS.md exists with content; (5) priors absent → no PRIORS.md; (6) metric with different directions (min/max) preserved in CAMPAIGN.json; (7) all user-facing strings in generated files say NightShift (zero GSD/labrat). Follow existing test pattern (assert/assertEq functions, node --test, tmpdir fixtures).
  - Verify: `npm test -- --test-name-pattern nightshift-interview` — all assertions pass
  - Done when: Test file exists with 7+ test scenarios, all pass, proving scaffold ↔ parser contract

## Files Likely Touched

- `src/resources/extensions/gsd/nightshift-interview.ts` (new)
- `src/resources/extensions/gsd/commands.ts`
- `src/resources/extensions/gsd/index.ts`
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` (new)
