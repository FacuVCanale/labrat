---
estimated_steps: 7
estimated_files: 6
---

# T02: Wire steering into auto.ts, enrich discuss command, create prompt template, and add command tests

**Slice:** S03 — Runtime Steering
**Milestone:** M002

## Description

Connect the `steering.ts` module to the running auto loop and the `labrat discuss` user command. This task makes steering functional end-to-end: the auto loop reads directives at experiment boundaries, the discuss command routes to a steering flow when a campaign is active, and an LLM-assisted prompt helps users formulate well-structured directives.

## Steps

1. **auto.ts — import and dispatchNextUnit wiring.** Add import for `checkSteeringDirective` and `getSteeringPromptOverride` from `./steering.js`. In the `experimenting` block of `dispatchNextUnit` (around line 1434), add steering check BEFORE the existing `checkAndAdvancePhase` call:
   ```typescript
   const steer = checkSteeringDirective(sliceDir, config);
   if (steer?.stop) { await stopAuto(ctx, pi); return; }
   if (steer?.notify) ctx.ui.notify(steer.notify, "info");
   ```
   This ensures steering directives (including skip_phase) are processed before the natural phase boundary detection.

2. **auto.ts — buildExperimentPrompt override.** In the `loadPrompt("run-experiment", {...})` call (~line 2017), add `steeringContext: getSteeringPromptOverride(sliceDir)` to the template variables object. This injects any active refocus message into the experiment prompt. Net: +1 line in the object literal.

3. **run-experiment.md — add template variable.** Add `{{steeringContext}}` on a new line after `{{phaseContext}}` (line 15). Both are empty-string-collapsible — zero behavioral change when no steering is active.

4. **guided-flow.ts — showSteering and buildSteeringPrompt.** Create `showSteering(ctx, pi, basePath)` following the `showPlan` pattern:
   - Guards: GSD project exists, active milestone, roadmap exists
   - Find slices with CAMPAIGN.json (reuse showPlan's campaign picker pattern)
   - If single campaign, auto-select; if multiple, show picker
   - Call `buildSteeringPrompt(mid, sliceId, basePath)` and dispatch as `gsd-steer` workflow
   
   Create `buildSteeringPrompt(mid, sid, basePath)`:
   - Read CAMPAIGN.json for campaign context
   - Read last 5 experiments from EXPERIMENT-LOG.jsonl for recent history summary
   - Read AGENDA-STATE.json for current phase info (if agenda exists)
   - Load and fill `steer-campaign.md` template with all context
   - Return assembled prompt string

5. **guided-flow.ts — routing in showDiscuss.** After the existing state derivation and guards in `showDiscuss`, add a check: if `state.phase === "experimenting"`, call `showSteering(ctx, pi, basePath)` and return. This makes `discuss` context-aware — campaign active means steering, no campaign means normal slice interview. Works cross-process because `deriveState` reads disk state.

6. **steer-campaign.md — create prompt template.** Include:
   - Campaign context (name, research question, target files, metrics, max experiments)
   - Current phase info (if agenda exists: phase name, dimension, goal, progress)
   - Recent experiment summary (last 5 experiments: ID, metrics, decision)
   - SteeringDirective JSON schema with all three types explained
   - Instructions for the LLM: ask user what they want to change, formulate a directive, write STEERING.json to the slice directory, then print latency notice "Steering directive written. Will take effect after the current experiment finishes."
   - Template variables: `{{campaignName}}`, `{{researchQuestion}}`, `{{targetFileList}}`, `{{metricDefinitions}}`, `{{maxExperiments}}`, `{{currentPhaseInfo}}`, `{{recentExperiments}}`, `{{sliceDir}}`

7. **steering-command.test.ts — command contract tests.** Following `plan-command.test.ts` pattern:
   - `buildSteeringPrompt` includes campaign name and research question
   - `buildSteeringPrompt` includes metric definitions
   - `buildSteeringPrompt` includes recent experiment summary when experiments exist
   - `buildSteeringPrompt` includes phase info when agenda exists
   - `buildSteeringPrompt` works without agenda (no phase info section)
   - `buildSteeringPrompt` handles empty experiment log
   - `buildSteeringPrompt` returns null on missing campaign config
   - Template `steer-campaign.md` exists and contains SteeringDirective schema
   - Template `run-experiment.md` contains `{{steeringContext}}` variable
   - Guard: returns early with no campaign
   
   Run all tests and build.

## Must-Haves

- [ ] `checkSteeringDirective` called in dispatchNextUnit BEFORE `checkAndAdvancePhase`
- [ ] `stop` directive halts auto-mode via `stopAuto`
- [ ] `steeringContext` template variable in run-experiment.md prompt
- [ ] `showDiscuss` routes to `showSteering` when `state.phase === "experimenting"`
- [ ] `steer-campaign.md` prompt template includes SteeringDirective JSON schema
- [ ] Prompt template instructs LLM to print latency notice after writing directive
- [ ] auto.ts ≤ 3275 lines
- [ ] All existing tests pass
- [ ] ≥ 25 command test assertions passing

## Verification

- `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts` — all assertions pass
- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — still passes (no regressions)
- `npm test` — full suite passes
- `npm run build` — compiles clean
- `wc -l src/resources/extensions/gsd/auto.ts` — reports ≤ 3275

## Inputs

- `src/resources/extensions/gsd/steering.ts` — T01 output: module with all read/write/clear/facade functions
- `src/resources/extensions/gsd/types.ts` — T01 output: SteeringDirective type
- `src/resources/extensions/gsd/auto.ts` — insertion points at lines ~76, ~1434, ~2017
- `src/resources/extensions/gsd/guided-flow.ts` — showDiscuss (routing), showPlan (structural template)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — add steeringContext variable
- `src/resources/extensions/gsd/prompts/plan-agenda.md` — structural template for steer-campaign.md
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — test pattern for prompt assembly tests

## Observability Impact

- **New runtime signals:** `ctx.ui.notify` messages fire on steering directive application in `dispatchNextUnit` — "Steering: refocused — <msg>", "Steering: skipped to next phase", "Steering: campaign stopped". These are user-visible in the auto-mode terminal.
- **Prompt injection:** `{{steeringContext}}` in `run-experiment.md` — non-empty only when STEERING-FOCUS.md exists. Inspect via `cat <slice-dir>/STEERING-FOCUS.md`.
- **Discuss routing:** When `state.phase === "experimenting"`, `labrat discuss` dispatches `gsd-steer` workflow instead of normal slice interview. Diagnostic: check `deriveState()` phase field.
- **Failure visibility:** Steering directive read failures surface via `[steering]` stderr prefix (from T01). This task adds no new failure paths — all error handling is in the steering.ts module.
- **Inspection surfaces:** `steer-campaign.md` template is loadable via `loadPrompt("steer-campaign", {...})`. Verify template substitution in test assertions.

## Expected Output

- `src/resources/extensions/gsd/auto.ts` — +1 import, +3 lines in dispatchNextUnit, +1 in buildExperimentPrompt (~3274 lines)
- `src/resources/extensions/gsd/guided-flow.ts` — showSteering() + buildSteeringPrompt() added, showDiscuss routing added
- `src/resources/extensions/gsd/commands.ts` — help text updated to mention steering
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — new prompt template (~80 lines)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — `{{steeringContext}}` variable added
- `src/resources/extensions/gsd/tests/steering-command.test.ts` — ~150 lines, ≥25 assertions
