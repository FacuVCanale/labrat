# S03: Runtime Steering

**Goal:** While `labrat auto` runs a campaign, `labrat discuss` in a separate terminal writes steering directives that the running loop picks up at the next experiment boundary.
**Demo:** Write a steering directive via `labrat discuss` (or `/gsd discuss` during a campaign). The running auto loop reads it at the next experiment boundary with a `ui.notify` message showing what changed. Proven by contract tests exercising atomic write/read, directive application (refocus, skip_phase, stop), prompt injection, and command prompt assembly.

## Must-Haves

- `steering.ts` module with atomic read/write/clear for `STEERING.json` (write-to-temp-then-rename, graceful JSON parse error recovery)
- `SteeringDirective` type: `{ type: 'refocus' | 'skip_phase' | 'stop', message: string, timestamp: string, appliedAt?: string }`
- `checkSteeringDirective()` facade function called from `dispatchNextUnit` — reads directive, applies it (refocus writes persistent context, skip_phase advances phase, stop signals halt), clears directive, returns notify message
- `getSteeringPromptOverride()` facade for prompt injection — reads persistent refocus context from `STEERING-FOCUS.md`
- Context-aware `discuss` command: routes to steering flow when `state.phase === "experimenting"`, otherwise existing discuss behavior
- `showSteering()` in guided-flow.ts with guards, prompt build, workflow dispatch
- `steer-campaign.md` prompt template with campaign context and SteeringDirective JSON schema
- Steering latency UX: prompt template instructs LLM to tell user "Will take effect after current experiment finishes"
- `skip_phase` on non-agenda campaign degrades gracefully (warn, no-op)
- auto.ts net line delta ≤ 5 lines (import + dispatchNextUnit wiring + prompt override)
- All existing tests pass (backward compatibility)

## Proof Level

- This slice proves: contract + integration (steering read/write/clear via unit tests, wiring via real auto.ts dispatch path functions, command routing via prompt assembly tests)
- Real runtime required: no (contract tests exercise all pure functions and facade behavior; LLM-assisted steering interaction verified by operational exercise at milestone level)
- Human/UAT required: no (deferred to milestone-level UAT for two-terminal operational exercise)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — atomic I/O, parse recovery, directive types, facade behavior, prompt override, skip_phase with/without agenda (~50 assertions)
- `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts` — prompt assembly, guards, context-aware routing, template substitution (~30 assertions)
- `npm test` — all existing tests still pass (no regressions)
- `npm run build` — compiles clean
- `wc -l src/resources/extensions/gsd/auto.ts` — ≤ 3275
- Failure-path diagnostic: `npx tsx -e "import {readSteeringDirective} from './src/resources/extensions/gsd/steering.ts'; console.log(readSteeringDirective('/nonexistent'))"` → prints `null` with `[steering]` stderr warning (corrupt/missing graceful recovery)

## Observability / Diagnostics

- Runtime signals: `ctx.ui.notify` on steering directive application ("Steering: refocused — <message>", "Steering: skipped to next phase", "Steering: campaign stopped")
- Inspection surfaces: `cat <slice-dir>/STEERING.json` for pending directives, `cat <slice-dir>/STEERING-FOCUS.md` for active refocus context, `jq '.' <slice-dir>/AGENDA-STATE.json` for phase state after skip
- Failure visibility: `[steering] Corrupt STEERING.json` stderr warning on parse failure, graceful null return (never blocks experiments)

## Integration Closure

- Upstream surfaces consumed: `agenda.ts` (readAgendaState, writeAgendaState, advancePhase, getCurrentPhase, getPhaseBestMetrics), `types.ts` (CampaignConfig, AgendaConfig), `auto.ts` (isAutoActive, dispatchNextUnit, buildExperimentPrompt), `guided-flow.ts` (showDiscuss routing), `eval-runner.ts` (readAllExperiments)
- New wiring introduced in this slice: 1 import + ~4 lines in auto.ts (dispatchNextUnit steering check, buildExperimentPrompt override), 3-line routing in showDiscuss, showSteering() + buildSteeringPrompt() in guided-flow.ts
- What remains before the milestone is truly usable end-to-end: nothing — S03 is the terminal slice in M002

## Tasks

- [x] **T01: Create steering.ts module with types, atomic I/O, facade functions, and contract tests** `est:25m`
  - Why: Retires the core technical risk (concurrent file access between two processes). All steering logic lives in this module — auto.ts gets only thin facade calls. Must be fully testable without touching auto.ts.
  - Files: `src/resources/extensions/gsd/steering.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/steering.test.ts`
  - Do: Add `SteeringDirective` type to types.ts. Create steering.ts with: `readSteeringDirective` (graceful parse recovery), `writeSteeringDirective` (temp+rename atomic), `clearSteeringDirective`, `writeSteeringFocus`/`clearSteeringFocus` for persistent refocus context, `getSteeringPromptOverride` (reads STEERING-FOCUS.md or returns empty string), `checkSteeringDirective` facade (read→apply→clear→return notify). For `skip_phase`: import advancePhase/readAgendaState/writeAgendaState from agenda.ts and advance phase. For `refocus`: write STEERING-FOCUS.md. For `stop`: return stop signal. Write steering.test.ts with ~50 assertions covering all paths: roundtrip I/O, atomic writes, corrupt file recovery, missing file, invalid shape, each directive type, skip_phase with and without agenda, facade returns, prompt override content.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` passes all assertions, `npm run build` compiles clean
  - Done when: steering.ts exports all listed functions, SteeringDirective type in types.ts, ≥45 contract test assertions passing

- [x] **T02: Wire steering into auto.ts, enrich discuss command, create prompt template, and add command tests** `est:25m`
  - Why: Connects the steering module to the running auto loop and provides the user-facing `discuss` command enrichment. Without this, steering.ts is a library with no callers.
  - Files: `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/guided-flow.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/prompts/steer-campaign.md`, `src/resources/extensions/gsd/prompts/run-experiment.md`, `src/resources/extensions/gsd/tests/steering-command.test.ts`
  - Do: (1) auto.ts: add import for checkSteeringDirective + getSteeringPromptOverride from steering.ts. In dispatchNextUnit experimenting block, add steering check BEFORE phase boundary check — if stop, call stopAuto and return; otherwise notify. In buildExperimentPrompt, add `steeringContext: getSteeringPromptOverride(sliceDir)` to loadPrompt params. (2) run-experiment.md: add `{{steeringContext}}` template variable after `{{phaseContext}}`. (3) guided-flow.ts: add `showSteering()` function (guards, campaign picker reusing showPlan pattern, build prompt, dispatch as `gsd-steer`), add `buildSteeringPrompt()` that inlines campaign context + recent experiments + current phase + SteeringDirective JSON schema. Route: in showDiscuss, check `state.phase === "experimenting"` at top and redirect to showSteering. (4) commands.ts: update help text to mention steering. (5) steer-campaign.md: prompt template with campaign context, directive types, JSON schema, latency notice instruction. (6) steering-command.test.ts: ~30 assertions testing buildSteeringPrompt assembly (campaign context, metrics, phase info, no-agenda case), routing logic, template variable substitution.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts` passes, `npm test` passes all existing + new tests, `npm run build` clean, `wc -l auto.ts` ≤ 3275
  - Done when: Steering check fires in dispatchNextUnit, discuss routes to steering for campaign state, prompt template exists and assembles correctly, ≥25 command test assertions passing

## Files Likely Touched

- `src/resources/extensions/gsd/steering.ts` (new — ~150 lines)
- `src/resources/extensions/gsd/types.ts` (add SteeringDirective type)
- `src/resources/extensions/gsd/auto.ts` (1 import + ~4 wiring lines)
- `src/resources/extensions/gsd/guided-flow.ts` (showSteering + buildSteeringPrompt + routing)
- `src/resources/extensions/gsd/commands.ts` (help text update)
- `src/resources/extensions/gsd/prompts/steer-campaign.md` (new prompt template)
- `src/resources/extensions/gsd/prompts/run-experiment.md` (add `{{steeringContext}}` variable)
- `src/resources/extensions/gsd/tests/steering.test.ts` (new — ~250 lines, ~50 assertions)
- `src/resources/extensions/gsd/tests/steering-command.test.ts` (new — ~150 lines, ~30 assertions)
