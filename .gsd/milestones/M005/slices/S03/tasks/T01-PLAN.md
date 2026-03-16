---
estimated_steps: 7
estimated_files: 4
---

# T01: Implement interview wizard, scaffold generator, and command wiring

**Slice:** S03 — /nightshift Interview & Scaffold
**Milestone:** M005

## Description

Build the `/nightshift` interactive command end-to-end: a programmatic wizard that collects research campaign parameters, a pure-function scaffold generator that produces parser-compatible output, and the command registration wiring. The scaffold generator is the highest-risk component — its output must match three different parser regexes exactly or the state machine silently breaks.

## Steps

1. **Extend CampaignConfig** — Add optional `priors?: string` field to `CampaignConfig` in `types.ts`. This is additive and backward-compatible per D042.

2. **Create nightshift-interview.ts — types and scaffold generator** — Define `NightShiftInterviewResult` interface (targetFiles, evalCommand, metrics[], priors?, hypothesisCount, experimentsPerHypothesis). Implement `generateNightShiftScaffold(basePath: string, config: NightShiftInterviewResult)` as a pure function that:
   - Creates milestone dir `M001` with `M001-ROADMAP.md` (hypothesis-slices S01..SN)
   - For each hypothesis-slice: creates `S0N-PLAN.md` (experiment-tasks T01..TM), `CAMPAIGN.json`, optional `PRIORS.md`
   - Roadmap lines MUST be: `- [ ] **S01: Hypothesis 1** \`risk:medium\` \`depends:[]\`` with `> After this:` demo line
   - Plan task lines MUST be: `- [ ] **T01: Experiment 1** \`est:15m\``
   - Plan frontmatter MUST include `status: in_progress`
   - CAMPAIGN.json shape: `{ name, researchQuestion, targetFiles, evalConfig: { command, timeout: 120, metrics, runs: 1 }, maxExperiments, budgetPerExperiment, priors? }`
   - Pad IDs: S01-S09, S10+ for >9 hypotheses; same for tasks
   - All string content says NightShift, not GSD

3. **Create nightshift-interview.ts — interview flow** — Implement `showNightShiftInterview(ctx: ExtensionCommandContext, pi: ExtensionAPI, basePath: string)`:
   - Git init if needed (follow showSmartEntry pattern: `git rev-parse --git-dir` try/catch)
   - Bootstrap `.gsd/` and `.gitignore` if needed
   - Collect via `ctx.ui.input()`: target files (comma-separated), eval command, then metric loop (name → direction via select min/max → weight, then "Add another metric?" via select)
   - Collect optional priors via `ctx.ui.input()` 
   - Collect hypothesis count (default 3) and experiments per hypothesis (default 10) via `ctx.ui.input()`
   - Handle Escape (null return) at any step → notify cancellation and return
   - Call `generateNightShiftScaffold()`
   - Git add + commit
   - Show `showNextAction()` offering to start auto-mode or continue manually

4. **Register `/nightshift` command** — In `commands.ts`, add `registerNightShiftCommand(pi: ExtensionAPI)` function that registers `/nightshift` with:
   - Bare `/nightshift` → `showNightShiftInterview(ctx, pi, basePath)`
   - `/nightshift auto` → `startAuto(ctx, pi, basePath)`
   - Description mentioning NightShift research interview

5. **Wire registration in index.ts** — Import `registerNightShiftCommand` from commands.ts and call it alongside `registerGSDCommand(pi)` in the extension setup.

6. **Ensure .gitignore and PREFERENCES** — Reuse `ensureGitignore(basePath)` and `ensurePreferences(basePath)` from the bootstrap path, matching showSmartEntry's pattern.

7. **Build check** — Run `npm run build` to verify compilation, fix any import/type issues.

## Must-Haves

- [ ] `generateNightShiftScaffold` is a pure function (no I/O besides fs writes to basePath)
- [ ] Roadmap lines match `parseRoadmapSlices` regex exactly
- [ ] Plan task lines match `parsePlan` regex exactly  
- [ ] CAMPAIGN.json passes `parseCampaignConfig` validation
- [ ] Escape handling at every `ctx.ui.input()` / `ctx.ui.select()` call
- [ ] `/nightshift` and `/nightshift auto` both registered and routed
- [ ] All user-facing strings say NightShift (zero GSD/labrat)
- [ ] `npm run build` passes

## Verification

- `npm run build` compiles without errors
- `grep -n 'registerNightShiftCommand\|nightshift' src/resources/extensions/gsd/commands.ts` shows registration
- `grep -n 'registerNightShiftCommand' src/resources/extensions/gsd/index.ts` shows wiring
- `grep 'priors' src/resources/extensions/gsd/types.ts` shows new field
- `rg -w 'GSD\|labrat\|Labrat' src/resources/extensions/gsd/nightshift-interview.ts` — zero hits

## Inputs

## Observability Impact

- **New inspection surface:** Generated scaffold files (ROADMAP, PLAN, CAMPAIGN.json, PRIORS.md) are the observable output — agents and users inspect them via filesystem reads.
- **Interview cancellation signal:** `ctx.ui.notify("NightShift interview cancelled", "warning")` — visible in TUI; future agents see this via notification history.
- **Scaffold generation errors:** Any fs write failure propagates as an uncaught exception in the interview flow, logged by Pi's error handler. No silent failures.
- **Parser contract:** Scaffold correctness is verified by roundtripping through `parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig` — null returns indicate format drift.
- **Command visibility:** `/nightshift` and `/nightshift auto` appear in Pi's command registry — agents can discover them via command listing.

## Inputs (source)

- `src/resources/extensions/gsd/commands.ts` lines 518-635 — handlePrefsWizard pattern for ctx.ui.input/select
- `src/cli.ts` lines 310-424 — nightshift start scaffold pattern (CAMPAIGN.json shape, roadmap/plan format)
- `src/resources/extensions/gsd/roadmap-slices.ts` line 22 — parseRoadmapSlices regex
- `src/resources/extensions/gsd/files.ts` line 351 — parsePlan task regex
- `src/resources/extensions/gsd/state.ts` lines 77-104 — parseCampaignConfig validation
- `src/resources/extensions/gsd/guided-flow.ts` lines 839-875 — showSmartEntry git/bootstrap pattern
- `src/resources/extensions/gsd/types.ts` lines 280-300 — CampaignConfig type

## Expected Output

- `src/resources/extensions/gsd/nightshift-interview.ts` — New module with `showNightShiftInterview()` and `generateNightShiftScaffold()` exports
- `src/resources/extensions/gsd/commands.ts` — `/nightshift` command registered
- `src/resources/extensions/gsd/index.ts` — Registration call added
- `src/resources/extensions/gsd/types.ts` — `priors?: string` added to CampaignConfig
