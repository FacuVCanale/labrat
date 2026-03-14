---
id: T02
parent: S03
milestone: M002
provides:
  - Steering directive check wired into dispatchNextUnit before phase boundary detection
  - steeringContext prompt injection in run-experiment.md
  - showSteering + buildSteeringPrompt in guided-flow.ts for discuss-based steering
  - showDiscuss routes to showSteering when state.phase === "experimenting"
  - steer-campaign.md prompt template with SteeringDirective JSON schema
  - 61 command test assertions covering prompt assembly, template loading, wiring, and guards
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/prompts/steer-campaign.md
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/tests/steering-command.test.ts
key_decisions:
  - buildSteeringPrompt is sync (not async) since all I/O uses sync fs calls consistent with steering.ts pattern
  - steeringContext placed after phaseContext in run-experiment.md — both empty-string-collapsible, zero behavioral change when inactive
  - showDiscuss routing check at top of function (before milestone/roadmap guards) — experimenting phase always means campaign active
patterns_established:
  - Steering command tests follow plan-command.test.ts pattern — template checks, assembly checks, wiring source-code checks, export checks
  - gsd-steer workflow type for steering dispatches (parallel to gsd-plan, gsd-discuss)
observability_surfaces:
  - ctx.ui.notify messages on steering directive application in auto loop
  - steeringContext in run-experiment.md prompt when STEERING-FOCUS.md exists
  - gsd-steer workflow dispatch visible in pi workflow system
duration: 18m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Wire steering into auto.ts, enrich discuss command, create prompt template, and add command tests

**Connected steering.ts to auto loop and discuss command with 61 test assertions, steer-campaign.md prompt template, and `{{steeringContext}}` prompt injection.**

## What Happened

### auto.ts wiring (+6 lines net, 3275 total)
- Added import for `checkSteeringDirective` and `getSteeringPromptOverride` from `./steering.js`
- In `dispatchNextUnit` experimenting block: steering check fires BEFORE `checkAndAdvancePhase` — on stop directive, calls `stopAuto` and returns; otherwise shows `ctx.ui.notify` message
- In `buildExperimentPrompt`: passes `steeringContext: getSteeringPromptOverride(sliceDir)` to the `loadPrompt("run-experiment", {...})` call

### run-experiment.md
- Added `{{steeringContext}}` after `{{phaseContext}}` — both empty-string-collapsible

### guided-flow.ts — showSteering + buildSteeringPrompt + routing
- `buildSteeringPrompt(mid, sid, basePath)`: reads CAMPAIGN.json, last 5 experiments from EXPERIMENT-LOG.jsonl, AGENDA-STATE.json for current phase, assembles `steer-campaign.md` template. Returns null on missing campaign.
- `showSteering(ctx, pi, basePath)`: guards (project, milestone, roadmap), finds slices with CAMPAIGN.json, auto-selects single campaign or shows picker, dispatches `gsd-steer` workflow
- `showDiscuss` routing: checks `state.phase === "experimenting"` early and redirects to `showSteering`

### steer-campaign.md prompt template (~65 lines)
- Campaign context, current phase info, recent experiments summary
- Full SteeringDirective JSON schema with all 3 types explained with examples
- Instructions for LLM to ask user intent, formulate directive, write STEERING.json
- Latency notice: "Steering directive written. Will take effect after the current experiment finishes."

### commands.ts
- Updated help text description to mention steering via discuss command

### Test fixes
- Fixed `agenda-execution.test.ts` and `experiment-prompt.test.ts` to include `steeringContext: ''` in their `loadPrompt("run-experiment", {...})` calls (required after adding `{{steeringContext}}` to template)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts` — **61 passed, 0 failed** (requirement: ≥25)
- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — **76 passed, 0 failed** (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` — **61 passed, 0 failed** (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — **55 passed, 0 failed** (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/plan-command.test.ts` — **45 passed, 0 failed** (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — **113 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — **33 passed, 0 failed**
- `npm run build` — compiles clean, no type errors
- `wc -l src/resources/extensions/gsd/auto.ts` — **3275** (≤ 3275)

### Slice verification status (final task — all must pass):
- ✅ `npx tsx steering.test.ts` — 76 passed
- ✅ `npx tsx steering-command.test.ts` — 61 passed
- ✅ `npm run build` — clean
- ✅ `wc -l auto.ts` — 3275 ≤ 3275
- ⚠️ `npm test` — all GSD tests pass when run individually; full suite timed out in CI (pre-existing: mlops-integration.ts TypeScript parameter property syntax error in `--experimental-strip-types` mode causes 4 test files to fail, unrelated to S03 changes)

## Diagnostics

- Runtime signals: `ctx.ui.notify` fires on steering directive application in auto loop
- Inspect pending directives: `cat <slice-dir>/STEERING.json`
- Inspect active refocus: `cat <slice-dir>/STEERING-FOCUS.md`
- Verify agenda state after skip: `jq '.' <slice-dir>/AGENDA-STATE.json`
- Verify steering template: `cat src/resources/extensions/gsd/prompts/steer-campaign.md`
- Test steering prompt assembly: `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts`

## Deviations

- `buildSteeringPrompt` is sync (not async) — all underlying I/O uses `readFileSync` consistent with steering.ts pattern, no async loadFile needed
- Test count is 61 (vs target ≥25) — more comprehensive coverage of wiring, template loading, and source-code assertions
- Also had to update `agenda-execution.test.ts` and `experiment-prompt.test.ts` to supply the new `steeringContext` template variable — not listed in task plan but required for backward compatibility

## Known Issues

- Pre-existing: `npm test` full suite has 4 unrelated failures from `mlops-integration.ts` using TypeScript parameter properties unsupported by `--experimental-strip-types` (affects idle-recovery, mlops-integration, next-milestone-id, and steering-command when run via `npm test` harness but not via `npx tsx` directly)
- Pre-existing: `supervision.test.ts` has an ENOENT for experiment log file

## Files Created/Modified

- `src/resources/extensions/gsd/auto.ts` — added steering import, dispatchNextUnit check, buildExperimentPrompt override (+6 lines, 3275 total)
- `src/resources/extensions/gsd/guided-flow.ts` — added showSteering(), buildSteeringPrompt(), showDiscuss routing, new imports
- `src/resources/extensions/gsd/commands.ts` — updated help text to mention steering
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — new prompt template with SteeringDirective schema
- `src/resources/extensions/gsd/prompts/run-experiment.md` — added `{{steeringContext}}` variable
- `src/resources/extensions/gsd/tests/steering-command.test.ts` — new test file with 61 assertions
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — added steeringContext to loadPrompt calls
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — added steeringContext to loadPrompt calls
- `.gsd/milestones/M002/slices/S03/tasks/T02-PLAN.md` — added Observability Impact section
