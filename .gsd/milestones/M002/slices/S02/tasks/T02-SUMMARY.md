---
id: T02
parent: S02
milestone: M002
provides:
  - checkAndAdvancePhase facade for phase boundary detection in dispatchNextUnit
  - getPhasePromptOverrides facade for phase-aware prompt building
  - stampPhaseIndex facade for experiment result phase attribution
  - phaseContext template variable in run-experiment.md
  - Phase-scoped experiment history and best metrics in experiment prompts
  - ExperimentResult.phaseIndex optional field for phase attribution
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/agenda.ts
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/tests/agenda-execution.test.ts
key_decisions:
  - Facade functions in agenda.ts (checkAndAdvancePhase, getPhasePromptOverrides, stampPhaseIndex) keep auto.ts thin — 3 imports, 3 call sites
  - Phase transitions in dispatchNextUnit, not deriveState (D044) — deriveState unchanged
  - phaseIndex stamped via JSONL last-line patch in stampPhaseIndex, not by modifying runExperimentPostProcess
patterns_established:
  - Facade function pattern for auto.ts wiring — multi-step agenda operations packaged as single calls
  - Template variable that is empty string for non-agenda campaigns — zero behavioral change via markdown whitespace collapsing
  - Phase-level metrics override chain: phase-scoped best > global best > no baseline
observability_surfaces:
  - ctx.ui.notify on phase transition — "Phase N → Phase N+1: <name>"
  - AGENDA-STATE.json updated atomically at phase boundaries — `jq '.' AGENDA-STATE.json`
  - phaseIndex field in EXPERIMENT-LOG.jsonl entries — `jq '.phaseIndex' EXPERIMENT-LOG.jsonl`
  - Phase context section visible in experiment prompts when agenda active
duration: 18m
verification_result: passed
completed_at: 2026-03-14T15:00:00Z
blocker_discovered: false
---

# T02: Phase-aware campaign execution wired through auto.ts and prompt template

**Wired agenda module into experiment loop via 3 facade functions — phase boundary detection, phase-aware prompts, and experiment phase attribution — with 61 integration test assertions passing and auto.ts at 3269 lines (19 net delta).**

## What Happened

Added three facade functions to `agenda.ts` that encapsulate multi-step phase operations: `checkAndAdvancePhase` (reads/creates state, detects boundary, advances, persists), `getPhasePromptOverrides` (returns phase-scoped context/history/metrics), and `stampPhaseIndex` (patches JSONL with phase attribution). Auto.ts wires these at three insertion points — `dispatchNextUnit` for boundary detection, `buildExperimentPrompt` for phase-aware context injection, and `handleAgentEnd` for phase attribution.

Updated `run-experiment.md` template with `{{phaseContext}}` variable between campaign overview and evaluation config. When empty string (non-agenda campaigns), markdown whitespace collapse makes it invisible. When populated, it shows current phase name, goal, dimension, experiment count, and previous phase results.

Added optional `phaseIndex` field to `ExperimentResult` type for phase attribution in experiment logs.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` — **61 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — **106 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — **113 passed, 0 failed** ✓
- `npm run build` — **exit code 0, zero errors** ✓
- `wc -l auto.ts` — **3269** (≤3270 target) ✓

### Slice-level verification status (T02 of 3):
- ✅ `agenda.test.ts` — 106 assertions passing
- ✅ `agenda-execution.test.ts` — 61 assertions passing
- ⬜ `plan-command.test.ts` — not yet created (T03)
- ✅ `derive-state.test.ts` — 113 passing (backward compat)
- ✅ `eval-runner.test.ts` — 73 passing (backward compat)
- ✅ `npm run build` — compiles clean
- ✅ Corrupt AGENDA-STATE.json recovery — tested in agenda-execution failure paths group
- ✅ Phase boundary failure path — non-agenda compat, corrupt state degradation, complete agenda no-op

## Diagnostics

- **Phase transition visibility:** `ctx.ui.notify` fires on phase advance with message "Phase N → Phase N+1: <name>"
- **State inspection:** `jq '.' <slice-dir>/AGENDA-STATE.json` shows currentPhaseIndex, completedPhases, phaseResults
- **Experiment attribution:** `jq '.phaseIndex' <slice-dir>/EXPERIMENT-LOG.jsonl` shows per-experiment phase index
- **Prompt inspection:** Phase context section visible in experiment prompt when agenda is active
- **Failure visibility:** Corrupt AGENDA-STATE.json → getPhasePromptOverrides returns empty context + global metrics (graceful degradation)

## Deviations

- Added 3 facade functions (`checkAndAdvancePhase`, `getPhasePromptOverrides`, `stampPhaseIndex`) to agenda.ts rather than inline logic in auto.ts — required to meet the ≤3270 line count constraint. All logic stays in agenda.ts as specified.
- `phaseIndex` stamped via JSONL last-line-patch in `stampPhaseIndex` rather than modifying `runExperimentPostProcess` — cleaner separation since eval-runner.ts is unchanged.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/auto.ts` — 3 thin wiring call sites: dispatchNextUnit boundary check, buildExperimentPrompt phase-aware overrides, handleAgentEnd phase stamping (3269 lines, 19 net delta)
- `src/resources/extensions/gsd/agenda.ts` — 3 facade functions added: checkAndAdvancePhase, getPhasePromptOverrides, stampPhaseIndex
- `src/resources/extensions/gsd/prompts/run-experiment.md` — `{{phaseContext}}` template variable added between campaign overview and evaluation config
- `src/resources/extensions/gsd/types.ts` — `phaseIndex?: number` added to ExperimentResult interface
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — new integration test file with 61 assertions
- `.gsd/milestones/M002/slices/S02/S02-PLAN.md` — pre-flight fix: added failure-path diagnostic verification step
- `.gsd/DECISIONS.md` — added D047 (facade function pattern)
