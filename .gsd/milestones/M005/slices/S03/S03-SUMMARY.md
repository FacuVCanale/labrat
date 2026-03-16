---
id: S03
parent: M005
milestone: M005
provides:
  - /nightshift interactive command (interview wizard collecting 6 research parameters)
  - generateNightShiftScaffold pure function producing parser-compatible hypothesis-slices and experiment-tasks
  - /nightshift auto routing to startAuto()
  - CampaignConfig.priors optional field
  - Contract test suite (8 scenarios, 99 assertions) proving scaffold↔parser roundtrip
requires:
  - slice: S01
    provides: NightShift naming consistency in generated scaffold text
affects:
  - S04
key_files:
  - src/resources/extensions/gsd/nightshift-interview.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/index.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/nightshift-interview.test.ts
key_decisions:
  - D084 /nightshift as programmatic wizard not LLM discussion
  - D085 Scaffold generator as pure function
  - D086 Priors stored in both CAMPAIGN.json and PRIORS.md
patterns_established:
  - Lazy import in command handler to avoid circular dependency at module load
  - padId helper for S01-S09/S10+ and T01-T09/T10+ ID formatting
  - Scaffold contract tests using tmpdir fixtures exercising generator then parsing output through real parsers
observability_surfaces:
  - ctx.ui.notify for interview cancellation and completion
  - Scaffold files on disk inspectable via filesystem reads
  - "npm test -- nightshift-interview.test.ts: 8 scenarios, 99 assertions — catches scaffold↔parser format drift"
drill_down_paths:
  - .gsd/milestones/M005/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S03/tasks/T02-SUMMARY.md
duration: 35m
verification_result: passed
completed_at: 2026-03-16
---

# S03: /nightshift Interview & Scaffold

**`/nightshift` command with programmatic interview wizard, pure-function scaffold generator producing parser-compatible hypothesis-slices and experiment-tasks, and `/nightshift auto` routing to autonomous mode.**

## What Happened

**T01 — Interview wizard, scaffold generator, and command wiring (20m):**
Created `nightshift-interview.ts` (373 lines) with two exports. `generateNightShiftScaffold(basePath, config)` is a pure function that writes an M001 roadmap with N hypothesis-slices, each containing M experiment-tasks via `S0N-PLAN.md`, `CAMPAIGN.json`, and optional `PRIORS.md`. Roadmap lines match `parseRoadmapSlices` regex, plan task lines match `parsePlan` regex, and CAMPAIGN.json passes `parseCampaignConfig` validation. IDs pad correctly (S01-S09, S10+; T01-T09, T10+). `showNightShiftInterview(ctx, pi, basePath)` collects target files, eval command, metrics (name/direction/weight loop), optional priors, hypothesis count, and experiments per hypothesis. Every null return from `ctx.ui.input()`/`ctx.ui.select()` triggers cancellation notification and early return. After scaffolding: git init if needed, bootstrap `.gsd/`, commit, then `showNextAction` offering auto-mode.

Registered `/nightshift` command in `commands.ts` — bare command routes to interview, `/nightshift auto` routes to `startAuto()`. Uses lazy import to avoid circular dependency. Wired `registerNightShiftCommand(pi)` in `index.ts`. Added optional `priors?: string` to `CampaignConfig` in `types.ts`.

**T02 — Contract tests (15m):**
Created 8 contract tests (99 assertions) in `nightshift-interview.test.ts` (340 lines) proving `generateNightShiftScaffold` output roundtrips through all three parsers: (1) 3×5 standard roundtrip, (2) 1×1 edge case, (3) 10+ hypotheses ID padding, (4) priors present → PRIORS.md created, (5) priors absent → no PRIORS.md, (6) mixed metric directions preserved, (7) NightShift naming compliance (zero GSD/labrat hits), (8) 10+ experiments T-padding. All use tmpdir fixtures with cleanup.

## Verification

- `npm test -- nightshift-interview.test.ts` — 99 passed, 0 failed ✅
- `npx tsc --noEmit` — compiles clean ✅
- `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts` — zero hits ✅
- Scaffold roundtrips through `parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig` — all parse correctly ✅
- 10+ hypotheses (S10, S11) and 10+ experiments (T10, T11) ID padding verified ✅
- Priors present/absent paths verified ✅
- Mixed metric directions (min/max) preserved in CAMPAIGN.json ✅

## Requirements Advanced

- R044 — `/nightshift` command registered, interview collects all 6 fields, scaffold generates parser-compatible hypothesis-slices and experiment-tasks, `/nightshift auto` routes to `startAuto()`

## Requirements Validated

- R044 — Contract tests prove scaffold roundtrips through all three parsers (parseRoadmapSlices, parsePlan, parseCampaignConfig). NightShift naming verified. Edge cases covered (1×1, 10+ hypotheses, priors present/absent, mixed metrics). Build compiles clean.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

Added an 8th test (10+ experiments T-padding) beyond the 7 specified in the plan — validates task ID padding alongside slice ID padding.

## Known Limitations

- Interview is programmatic wizard only (no LLM-assisted mode) — sufficient for structured field collection per D084
- Scaffold generates generic "Hypothesis N" / "Experiment N" placeholder names — S04 will add hypothesis-native prompts that give these meaning
- No runtime validation that `/nightshift auto` actually starts the hypothesis flow correctly — that's S05/S06's job

## Follow-ups

- none — all work scoped to S03 is complete

## Files Created/Modified

- `src/resources/extensions/gsd/nightshift-interview.ts` — New module: scaffold generator + interview wizard (373 lines)
- `src/resources/extensions/gsd/commands.ts` — Added `registerNightShiftCommand` with `/nightshift` and `/nightshift auto` routing
- `src/resources/extensions/gsd/index.ts` — Wired `registerNightShiftCommand(pi)` call
- `src/resources/extensions/gsd/types.ts` — Added optional `priors?: string` to `CampaignConfig`
- `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` — Contract test file with 8 scenarios (99 assertions)

## Forward Intelligence

### What the next slice should know
- `generateNightShiftScaffold` writes CAMPAIGN.json with `priors` field and PRIORS.md per hypothesis-slice — S04 prompts can read both
- The scaffold uses M001 as the milestone ID and generic hypothesis/experiment names — S04 prompts should inject research-specific terminology at runtime
- `padId` helper in nightshift-interview.ts handles S01-S09/S10+ formatting — reuse if needed elsewhere

### What's fragile
- Scaffold format is tightly coupled to parser regexes — roadmap lines must match `/^\s*-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/` and plan task lines must match `/^-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/`. Any format change in either direction breaks the contract.
- `parseCampaignConfig` returns null on any validation failure — silent null return is the only signal of format drift

### Authoritative diagnostics
- `npm test -- nightshift-interview.test.ts` — 99 assertions catch scaffold↔parser format drift immediately
- Check `CAMPAIGN.json` structure in generated scaffold against `parseCampaignConfig` source in `state.ts` if adding new config fields

### What assumptions changed
- No assumptions changed — implementation matched the plan closely
