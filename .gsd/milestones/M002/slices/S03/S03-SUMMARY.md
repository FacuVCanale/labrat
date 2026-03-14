---
id: S03
parent: M002
milestone: M002
provides:
  - steering.ts module with atomic read/write/clear for STEERING.json and STEERING-FOCUS.md
  - SteeringDirective type (refocus, skip_phase, stop) in types.ts
  - checkSteeringDirective facade for experiment-boundary steering in dispatchNextUnit
  - getSteeringPromptOverride for prompt injection via STEERING-FOCUS.md
  - showSteering + buildSteeringPrompt in guided-flow.ts for LLM-assisted discuss-based steering
  - steer-campaign.md prompt template with SteeringDirective JSON schema
  - Context-aware discuss routing — showDiscuss redirects to showSteering when campaign active
  - {{steeringContext}} template variable in run-experiment.md
requires:
  - slice: S02
    provides: agenda.ts (readAgendaState, writeAgendaState, advancePhase, getCurrentPhase, getPhaseBestMetrics), CampaignConfig with agenda field, AGENDA-STATE.json format, phase boundary detection pattern
affects: []
key_files:
  - src/resources/extensions/gsd/steering.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/prompts/steer-campaign.md
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/tests/steering.test.ts
  - src/resources/extensions/gsd/tests/steering-command.test.ts
key_decisions:
  - D048 — Steering directive types limited to refocus, skip_phase, stop; add_experiments deferred
  - D049 — Persistent refocus context via STEERING-FOCUS.md (survives across experiments, cleared on phase boundary)
  - D050 — Discuss command routing via deriveState phase check (no new subcommand)
  - D051 — LLM-assisted steering via gsd-steer workflow dispatch
patterns_established:
  - Atomic write-to-temp-then-rename for concurrent file access (D041/D045 pattern applied to STEERING.json)
  - SteeringResult facade return type with optional stop flag for clean caller semantics
  - Context-aware command routing (showDiscuss → showSteering) based on state.phase
observability_surfaces:
  - ctx.ui.notify messages on steering directive application ("Steering: refocused — <msg>", "Steering: skipped to next phase", "Steering: campaign stopped")
  - cat <slice-dir>/STEERING.json for pending directives
  - cat <slice-dir>/STEERING-FOCUS.md for active refocus context
  - jq '.' <slice-dir>/AGENDA-STATE.json for phase state after skip_phase
  - "[steering] Corrupt STEERING.json" stderr warning on parse failure (graceful null return)
drill_down_paths:
  - .gsd/milestones/M002/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S03/tasks/T02-SUMMARY.md
duration: 30m
verification_result: passed
completed_at: 2026-03-14
---

# S03: Runtime Steering

**Steering module with atomic I/O, experiment-boundary directive processing, LLM-assisted discuss-based steering command, and prompt injection — enabling mid-campaign redirection from a separate terminal.**

## What Happened

### T01: steering.ts module (12m)
Created `steering.ts` (~219 lines) following the agenda.ts extraction pattern (D039). Added `SteeringDirective` type to `types.ts` with three directive types: `refocus`, `skip_phase`, `stop`. The module provides:

- **Atomic I/O**: `writeSteeringDirective` uses write-to-temp-then-rename (D041/D045). `readSteeringDirective` validates shape (type must be one of the three allowed values) and recovers gracefully from corrupt/missing JSON, returning null with `[steering]` stderr warning.
- **Persistent refocus context**: `writeSteeringFocus`/`getSteeringPromptOverride` manage `STEERING-FOCUS.md` — a markdown file that persists the refocus message across subsequent experiments for prompt injection.
- **`checkSteeringDirective` facade**: Single entry point for the auto loop — reads directive, applies it (refocus writes focus file; skip_phase advances via agenda.ts; stop returns halt signal), clears the consumed directive, returns `SteeringResult` with notify message and optional stop flag.

For `skip_phase`: imports `readAgendaState`, `writeAgendaState`, `advancePhase`, `getCurrentPhase`, `getPhaseBestMetrics` from agenda.ts. Degrades gracefully for non-agenda campaigns (warn + no-op), missing agenda state, and all-phases-complete scenarios.

### T02: Wiring + command + prompt template (18m)
Connected steering.ts to the running system:

- **auto.ts** (+6 lines net, 3275 total): Import `checkSteeringDirective` + `getSteeringPromptOverride`. In `dispatchNextUnit` experimenting block, steering check fires BEFORE `checkAndAdvancePhase` — stop calls `stopAuto`, otherwise `ctx.ui.notify`. In `buildExperimentPrompt`, passes `steeringContext` to `loadPrompt`.
- **run-experiment.md**: Added `{{steeringContext}}` after `{{phaseContext}}` — both empty-string-collapsible, zero behavioral change when inactive.
- **guided-flow.ts**: `buildSteeringPrompt()` assembles campaign context, last 5 experiments, current phase info into `steer-campaign.md` template. `showSteering()` with guards, campaign picker, `gsd-steer` workflow dispatch. `showDiscuss` routes to `showSteering` when `state.phase === "experimenting"`.
- **steer-campaign.md**: ~65-line prompt template with campaign context, SteeringDirective JSON schema, all 3 types explained with examples, latency notice instruction.
- **commands.ts**: Updated help text to mention steering.
- Fixed `agenda-execution.test.ts` and `experiment-prompt.test.ts` to supply `steeringContext: ''` (required after adding template variable).

## Verification

| Check | Result |
|-------|--------|
| `npx tsx steering.test.ts` | **76 passed**, 0 failed |
| `npx tsx steering-command.test.ts` | **61 passed**, 0 failed |
| `npm run build` | compiles clean |
| `wc -l auto.ts` | **3275** (≤ 3275) |
| `npx tsx agenda-execution.test.ts` | 61 passed (no regression) |
| `npx tsx experiment-prompt.test.ts` | 55 passed (no regression) |
| `npx tsx plan-command.test.ts` | 45 passed (no regression) |
| `npx tsx derive-state.test.ts` | 113 passed (no regression) |
| `npx tsx research-types.test.ts` | 33 passed (no regression) |

**137 new contract test assertions** (76 steering + 61 steering-command). All S01/S02 regression suites pass.

Failure-path diagnostic (`readSteeringDirective('/nonexistent')`) returns null — proven by contract test "readSteeringDirective: missing file returns null" (inline `npx tsx -e` invocation fails due to `@gsd/pi-coding-agent` package resolution in bare import context, not a steering bug).

## Requirements Advanced

- R018 (Runtime Steering) — Moved from deferred to validated. Steering module fully implements mid-campaign redirection via discuss command.

## Requirements Validated

- R018 — `labrat discuss` during active campaign routes to steering flow. LLM-assisted directive formulation writes STEERING.json. Auto loop reads directive at experiment boundary via `checkSteeringDirective` in `dispatchNextUnit`. Three directive types (refocus, skip_phase, stop) with graceful degradation. Proven by 137 contract tests.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- steering.ts is 219 lines (estimated ~150) — comprehensive validation and three graceful-degradation paths in skip_phase
- Test files total 584 + ~450 lines (estimated ~250 + ~150) — 137 assertions vs target ≥75
- `buildSteeringPrompt` is sync (not async) — all underlying I/O uses `readFileSync` consistent with steering.ts pattern
- Had to update `agenda-execution.test.ts` and `experiment-prompt.test.ts` to supply `steeringContext: ''` — not in task plan but required after adding template variable

## Known Limitations

- `add_experiments` directive type deferred (D048) — semantics unclear, three shipped types cover core value
- `npm test` full suite has pre-existing failures from `mlops-integration.ts` TypeScript parameter property syntax in `--experimental-strip-types` mode (unrelated to S03, affects 4 test files when run via npm test harness but not via npx tsx directly)
- Steering latency is instruction-based only (prompt tells LLM to inform user) — no countdown timer or active polling

## Follow-ups

- none — S03 is the terminal slice in M002

## Files Created/Modified

- `src/resources/extensions/gsd/steering.ts` — new module (~219 lines) with atomic I/O, facade functions
- `src/resources/extensions/gsd/types.ts` — added SteeringDirective interface
- `src/resources/extensions/gsd/auto.ts` — +6 lines (import, dispatchNextUnit check, prompt override)
- `src/resources/extensions/gsd/guided-flow.ts` — showSteering(), buildSteeringPrompt(), showDiscuss routing
- `src/resources/extensions/gsd/commands.ts` — updated help text
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — new prompt template (~65 lines)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — added `{{steeringContext}}` variable
- `src/resources/extensions/gsd/tests/steering.test.ts` — 76 contract test assertions
- `src/resources/extensions/gsd/tests/steering-command.test.ts` — 61 contract test assertions
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — added steeringContext to loadPrompt calls
- `src/resources/extensions/gsd/tests/experiment-prompt.test.ts` — added steeringContext to loadPrompt calls

## Forward Intelligence

### What the next slice should know
- S03 is terminal in M002 — no downstream slices. Forward intelligence applies to M003.
- auto.ts is at 3275 lines (the configured ceiling). Any future additions must extract lines or increase the limit.
- The steering module follows the same extraction pattern as simplicity-scorer.ts, agenda.ts — pure functions with facade, atomic I/O, called from auto.ts with thin wiring.

### What's fragile
- auto.ts line count at exactly 3275 (ceiling) — any new wiring requires compensating extractions
- `npm test` harness has pre-existing failures from mlops-integration.ts parameter property syntax — not a real regression but creates noise in CI

### Authoritative diagnostics
- `cat <slice-dir>/STEERING.json` — pending directive (consumed-then-deleted, usually empty)
- `cat <slice-dir>/STEERING-FOCUS.md` — active refocus context (persists across experiments)
- `npx tsx steering.test.ts` — 76 assertions covering all steering paths
- `npx tsx steering-command.test.ts` — 61 assertions covering wiring, prompt assembly, routing

### What assumptions changed
- Estimated 150 lines for steering.ts → actually 219 due to three graceful-degradation paths in skip_phase
- Estimated ~80 test assertions → actually 137 due to more comprehensive edge case coverage
