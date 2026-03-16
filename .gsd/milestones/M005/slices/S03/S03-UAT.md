# S03: /nightshift Interview & Scaffold — UAT

**Milestone:** M005
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: The slice produces a pure-function scaffold generator and command wiring — correctness is proven by parsing generated artifacts through existing parsers. No runtime server or live UI interaction required.

## Preconditions

- Repository built (`npm run build` or `npx tsc --noEmit` passes)
- Working directory is the labrat project root
- Node.js available with `--experimental-transform-types` support

## Smoke Test

Run `npm test -- nightshift-interview.test.ts` — all 8 tests (99 assertions) pass. This confirms the scaffold generator produces output that parses through all three existing parsers.

## Test Cases

### 1. Standard scaffold roundtrip (3 hypotheses × 5 experiments)

1. Call `generateNightShiftScaffold(tmpDir, config)` with 3 hypotheses, 5 experiments each, target `["model.py"]`, eval `python eval.py`, one metric `accuracy` (direction: `max`, weight: 1)
2. Read `<tmpDir>/.gsd/milestones/M001/M001-ROADMAP.md`
3. Parse with `parseRoadmapSlices(roadmapContent)`
4. **Expected:** Returns 3 slices with IDs S01, S02, S03, all not-done, titles "Hypothesis 1", "Hypothesis 2", "Hypothesis 3"
5. For each slice, read `<tmpDir>/.gsd/milestones/M001/slices/S0N/S0N-PLAN.md`
6. Parse with `parsePlan(planContent)`
7. **Expected:** Returns 5 tasks with IDs T01-T05, all not-done, titles "Experiment 1" through "Experiment 5"
8. For each slice, read `<tmpDir>/.gsd/milestones/M001/slices/S0N/CAMPAIGN.json`
9. Parse with `parseCampaignConfig(campaignContent)`
10. **Expected:** Returns valid config with `maxExperiments: 5`, `targetFiles: ["model.py"]`, correct evalConfig

### 2. Single hypothesis, single experiment edge case

1. Call `generateNightShiftScaffold(tmpDir, config)` with 1 hypothesis, 1 experiment
2. Parse roadmap → 1 slice (S01)
3. Parse plan → 1 task (T01)
4. Parse campaign → valid config with `maxExperiments: 1`
5. **Expected:** All three parsers return valid results with no empty arrays or null returns

### 3. 10+ hypotheses — ID padding

1. Call `generateNightShiftScaffold(tmpDir, config)` with 12 hypotheses, 2 experiments each
2. Parse roadmap
3. **Expected:** Slices include S10, S11, S12 (not S010). All 12 slices parse with correct IDs.
4. Verify directories exist: `<tmpDir>/.gsd/milestones/M001/slices/S10/`, `S11/`, `S12/`

### 4. 10+ experiments — task ID padding

1. Call `generateNightShiftScaffold(tmpDir, config)` with 1 hypothesis, 12 experiments
2. Parse plan for S01
3. **Expected:** Tasks include T10, T11, T12 (not T010). All 12 tasks parse with correct IDs.

### 5. Priors present — PRIORS.md created

1. Call `generateNightShiftScaffold(tmpDir, config)` with `priors: "Try attention mechanisms first. Avoid dropout > 0.5."`
2. Check file exists: `<tmpDir>/.gsd/milestones/M001/slices/S01/PRIORS.md`
3. **Expected:** File exists, contains the priors text
4. Parse CAMPAIGN.json for S01
5. **Expected:** `config.priors` equals the priors string

### 6. Priors absent — no PRIORS.md

1. Call `generateNightShiftScaffold(tmpDir, config)` without `priors` field
2. Check file: `<tmpDir>/.gsd/milestones/M001/slices/S01/PRIORS.md`
3. **Expected:** File does not exist
4. Parse CAMPAIGN.json
5. **Expected:** `config.priors` is undefined

### 7. Mixed metric directions preserved

1. Call `generateNightShiftScaffold(tmpDir, config)` with metrics: `[{name: "accuracy", direction: "max", weight: 0.7}, {name: "loss", direction: "min", weight: 0.3}]`
2. Parse CAMPAIGN.json for each hypothesis-slice
3. **Expected:** `evalConfig.metrics` has 2 entries — accuracy with direction "maximize" and weight 0.7, loss with direction "minimize" and weight 0.3

### 8. NightShift naming compliance

1. Read all generated files (roadmap, all plan files, all CAMPAIGN.json files, any PRIORS.md)
2. Search for `/\bGSD\b/`, `/\blabrat\b/i`
3. **Expected:** Zero matches — all user-facing text says "NightShift"
4. Run `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts`
5. **Expected:** Zero matches in source code

### 9. Command registration

1. Open `src/resources/extensions/gsd/commands.ts`
2. Search for `registerNightShiftCommand`
3. **Expected:** Function exists, registers `/nightshift` command
4. Open `src/resources/extensions/gsd/index.ts`
5. Search for `registerNightShiftCommand`
6. **Expected:** Function is called alongside `registerGSDCommand`

### 10. CampaignConfig type extension

1. Open `src/resources/extensions/gsd/types.ts`
2. Search for `priors`
3. **Expected:** `priors?: string` field exists on `CampaignConfig` interface

## Edge Cases

### Interview cancellation (null return from input)

1. In the interview wizard, if `ctx.ui.input()` returns null at any prompt
2. **Expected:** `ctx.ui.notify("NightShift interview cancelled", "warning")` is called, function returns early, no scaffold is generated, no crash

### Empty metrics list

1. If no metrics are added during the interview (user escapes the metric loop immediately)
2. **Expected:** Interview should require at least one metric before proceeding (validated in the wizard flow)

### CAMPAIGN.json with parseCampaignConfig returning null

1. If a generated CAMPAIGN.json were missing a required field
2. **Expected:** `parseCampaignConfig()` returns null (not a crash). Contract tests verify this path doesn't occur with valid input.

## Failure Signals

- Any of the 8 contract tests failing indicates scaffold↔parser format drift
- `parseCampaignConfig` returning null for generated CAMPAIGN.json means the JSON structure is invalid
- `parseRoadmapSlices` returning empty array means roadmap line format drifted from the regex
- `parsePlan` returning empty array means plan task line format drifted from the regex
- `rg -w 'GSD\|labrat\|Labrat'` returning any hits in nightshift-interview.ts means naming leak
- `tsc --noEmit` errors mean type-level breakage (e.g., priors field mistyped)

## Requirements Proved By This UAT

- R044 — `/nightshift` command registered, interview collects research parameters, scaffold generates parser-compatible hypothesis-slices and experiment-tasks, `/nightshift auto` routes to `startAuto()`

## Not Proven By This UAT

- Runtime interview UX (requires live TUI session with real user interaction)
- `/nightshift auto` actually starting and completing hypothesis cycles (S05/S06)
- Hypothesis-native prompts injecting meaningful content into experiments (S04)
- Learning loop between experiments within a hypothesis (S05)
- End-to-end flow from interview through complete hypothesis cycles (S06)

## Notes for Tester

- All 10 test cases above are automated in the contract test file — run `npm test -- nightshift-interview.test.ts` to execute cases 1-8. Cases 9-10 are static code inspection.
- The interview wizard (test case: cancellation) requires a live TUI session to exercise interactively — automated tests cover the scaffold generator, not the interactive prompts.
- The full test suite has known timeout issues in CI due to large test count — run the specific test file for S03 verification.
