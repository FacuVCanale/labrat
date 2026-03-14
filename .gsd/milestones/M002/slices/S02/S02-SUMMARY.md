---
id: S02
parent: M002
milestone: M002
provides:
  - agenda.ts module with AgendaConfig, AgendaPhase, ExperimentPlan, AgendaState types
  - parseAgenda validation, readAgendaState/writeAgendaState atomic I/O, getCurrentPhase/advancePhase/shouldAdvancePhase navigation
  - Facade functions (checkAndAdvancePhase, getPhasePromptOverrides, stampPhaseIndex) for thin auto.ts wiring
  - Phase boundary detection in dispatchNextUnit with automatic phase advance
  - Phase-specific context injection in buildExperimentPrompt (phase goals, dimension, phase-level best metrics, phase-filtered history)
  - phaseContext template variable in run-experiment.md (empty string for non-agenda campaigns)
  - ExperimentResult.phaseIndex for per-experiment phase attribution in JSONL
  - CampaignConfig.agenda optional field (backward compatible)
  - AGENDA-STATE.json crash-recoverable state file with atomic writes
  - showPlan() command with campaign picker, guard checks, and buildPlanPrompt()
  - plan-agenda.md prompt template with AgendaConfig JSON schema and example agenda
  - checkAutoStartAfterPlan() bridge initializing AGENDA-STATE.json and triggering auto-mode
requires:
  - slice: S01
    provides: Module extraction pattern (D039), CampaignConfig extension pattern (D042), simplicity-scorer.ts as structural precedent
affects:
  - S03
key_files:
  - src/resources/extensions/gsd/agenda.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/prompts/run-experiment.md
  - src/resources/extensions/gsd/prompts/plan-agenda.md
  - src/resources/extensions/gsd/index.ts
  - src/resources/extensions/gsd/tests/agenda.test.ts
  - src/resources/extensions/gsd/tests/agenda-execution.test.ts
  - src/resources/extensions/gsd/tests/plan-command.test.ts
key_decisions:
  - D044: Phase transitions in dispatchNextUnit, not deriveState — isolates phase logic from 560-line state derivation critical path
  - D045: Atomic AGENDA-STATE.json writes via temp+rename — crash-recoverable, matching D041 pattern
  - D046: Phase-scoped metrics/history as agenda.ts functions — wraps eval-runner functions without coupling
  - D047: Facade functions for auto.ts call sites — 3 imports, 3 calls, auto.ts stays at 3269 lines
patterns_established:
  - Facade function pattern for auto.ts wiring — multi-step agenda operations packaged as single calls
  - Template variable that is empty string for non-agenda campaigns — zero behavioral change via markdown whitespace collapsing
  - Phase-level metrics override chain: phase-scoped best > global best > no baseline
  - Auto-start bridge for plan command (pendingPlanAutoStart stash alongside discuss)
  - Campaign-aware slice picker — showPlan finds slices with CAMPAIGN.json
observability_surfaces:
  - AGENDA-STATE.json in slice directory — `jq '.' AGENDA-STATE.json` for phase progress
  - CAMPAIGN.json agenda field — `jq '.agenda' CAMPAIGN.json` for agenda structure
  - ctx.ui.notify on phase transition — "Phase N → Phase N+1: <name>"
  - phaseIndex in EXPERIMENT-LOG.jsonl — per-experiment phase attribution
  - gsd-plan customType in dispatched message confirms plan flow triggered
  - Corrupt state recovery with stderr warning — `[agenda] Corrupt AGENDA-STATE.json`
drill_down_paths:
  - .gsd/milestones/M002/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S02/tasks/T03-SUMMARY.md
duration: 53m
verification_result: passed
completed_at: 2026-03-14
---

# S02: Research Agenda Planning & Execution

**Structured research agenda system: `agenda.ts` module with phase types/navigation/persistence, phase-aware experiment execution wired into auto.ts via facade functions, and `labrat plan` interactive command with LLM-driven agenda decomposition — 212 new test assertions, all 186 existing backward-compat tests passing, auto.ts at 3269 lines.**

## What Happened

Built the complete agenda subsystem in three tasks:

**T01 — Agenda module foundation** (15m): Created `agenda.ts` with 4 type definitions (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`), validation (`parseAgenda`), atomic state I/O (`readAgendaState`/`writeAgendaState` via temp+rename), phase navigation (`getCurrentPhase`/`advancePhase`/`shouldAdvancePhase`), and T02 helper functions (`getPhaseContext`/`getPhaseBestMetrics`/`getPhaseFilteredHistory`). Types live in `types.ts` following the codebase convention, re-exported from `agenda.ts`. `CampaignConfig` extended with optional `agenda` field — zero changes needed to `parseCampaignConfig`. State includes `version: 1` for future migration. 106 assertions.

**T02 — Phase-aware execution wiring** (18m): Added 3 facade functions to `agenda.ts` (`checkAndAdvancePhase`, `getPhasePromptOverrides`, `stampPhaseIndex`) that auto.ts calls at 3 insertion points: `dispatchNextUnit` for boundary detection, `buildExperimentPrompt` for phase-aware context, `handleAgentEnd` for phase attribution. Updated `run-experiment.md` with `{{phaseContext}}` variable — empty string for non-agenda campaigns means zero behavioral change via markdown whitespace collapse. Added `phaseIndex` to `ExperimentResult`. Auto.ts at 3269 lines (19 net delta). 61 assertions.

**T03 — Plan command and auto-start bridge** (20m): Registered `/gsd plan` in `commands.ts`. Created `showPlan()` in `guided-flow.ts` with campaign-specific guards (GSD project, milestone, campaign config, no existing agenda). `buildPlanPrompt()` inlines campaign context into `plan-agenda.md` template which includes the complete `AgendaConfig` JSON schema and a 3-phase example. `checkAutoStartAfterPlan()` bridge validates the written agenda via `parseAgenda`, initializes `AGENDA-STATE.json`, and triggers auto-mode. 45 assertions.

## Verification

| Test Suite | Assertions | Status |
|---|---|---|
| `agenda.test.ts` | 106 | ✅ passed |
| `agenda-execution.test.ts` | 61 | ✅ passed |
| `plan-command.test.ts` | 45 | ✅ passed |
| `derive-state.test.ts` | 113 | ✅ passed (backward compat) |
| `eval-runner.test.ts` | 73 | ✅ passed (backward compat) |
| `npm run build` | — | ✅ compiles clean |
| `auto.ts line count` | 3269 | ✅ ≤3270 |

**Total: 212 new + 186 existing = 398 assertions passing.** Corrupt AGENDA-STATE.json recovery, non-agenda backward compatibility, and phase boundary failure paths all verified.

## Requirements Advanced

- R016 (Research Agenda Planning) — `labrat plan` decomposes research questions into structured agendas with phases. Prompt template includes JSON schema. Auto-start bridge initializes state and triggers campaign.
- R020 (Experiment Dependency/Sequencing) — Phase boundary detection in `dispatchNextUnit` executes experiments phase-by-phase. Phase advance triggers reassessment. Phase-level baselines update at boundaries.

## Requirements Validated

- R016 — Proven by 45 plan-command tests (prompt assembly, command registration, agenda validation, auto-start bridge) + 106 agenda tests (parsing, state persistence, phase transitions).
- R020 — Proven by 61 agenda-execution tests (phase boundary detection, phase-scoped context/metrics/history, phase advance, non-agenda backward compat, failure paths).

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Types placed in `types.ts` rather than only in `agenda.ts` — follows existing codebase pattern where all type definitions live in `types.ts`, with re-exports from `agenda.ts`.
- Added `createInitialAgendaState` factory function not in the original task plan — needed for clean state initialization with pre-computed experiment ranges.
- `phaseIndex` stamped via JSONL last-line-patch in `stampPhaseIndex` rather than modifying `runExperimentPostProcess` — cleaner separation, eval-runner.ts unchanged.

## Known Limitations

- Agenda decomposition quality depends on the LLM model and prompt — bounded by the JSON schema format but not guaranteed to produce meaningful phases. UAT deferred to milestone-level verification.
- `maxExperiments` is the hard campaign ceiling but phase-level experiment counts are advisory — a phase that uses more experiments than planned simply exhausts the remaining budget faster.
- No DAG-based experiment dependencies (D040) — sequential phases only. Build DAG only if sequential proves insufficient.

## Follow-ups

- S03 (Runtime Steering) consumes `AgendaConfig` and `AGENDA-STATE.json` for phase-level steering (`refocus` within phase, `skip_phase` to advance).
- S03 will add `STEERING.json` with the same atomic write pattern (D041/D045).

## Files Created/Modified

- `src/resources/extensions/gsd/agenda.ts` — new module (~350 lines) with types, validation, state I/O, phase navigation, facade functions
- `src/resources/extensions/gsd/types.ts` — added AgendaConfig, AgendaPhase, ExperimentPlan, AgendaState types; extended CampaignConfig and ExperimentResult
- `src/resources/extensions/gsd/auto.ts` — 3 thin wiring call sites (3269 lines, 19 net delta)
- `src/resources/extensions/gsd/commands.ts` — "plan" subcommand registration and handler
- `src/resources/extensions/gsd/guided-flow.ts` — showPlan(), buildPlanPrompt(), checkAutoStartAfterPlan(), pendingPlanAutoStart
- `src/resources/extensions/gsd/index.ts` — wired checkAutoStartAfterPlan in agent_end handler
- `src/resources/extensions/gsd/prompts/run-experiment.md` — `{{phaseContext}}` template variable
- `src/resources/extensions/gsd/prompts/plan-agenda.md` — new prompt template with JSON schema and example
- `src/resources/extensions/gsd/tests/agenda.test.ts` — 106 assertions
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — 61 assertions
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — 45 assertions

## Forward Intelligence

### What the next slice should know
- `agenda.ts` exports everything S03 needs: `readAgendaState`, `writeAgendaState`, `getCurrentPhase`, `advancePhase`, `AgendaState`, `AgendaConfig`. Import from `./agenda.ts`.
- The facade function pattern (`checkAndAdvancePhase`, etc.) is the right model for S03's steering check — package multi-step steering reads as a single `checkSteeringDirective()` call from `dispatchNextUnit`.
- `pendingPlanAutoStart` in guided-flow.ts follows the same stash pattern as `pendingAutoStart` for discuss — S03's `labrat discuss` steering will use this same approach.
- Phase boundary detection in `dispatchNextUnit` is the natural insertion point for S03's steering check — steering should be read at the same experiment boundary, before or after phase advance.

### What's fragile
- auto.ts is at 3269 lines (19 from the 3250 baseline, hard limit ~3270 for the slice plan) — S03 must keep wiring calls minimal or extract more into steering.ts.
- `stampPhaseIndex` patches the last line of JSONL — if the JSONL format changes or entries span multiple lines, this will break.

### Authoritative diagnostics
- `jq '.' <slice-dir>/AGENDA-STATE.json` — ground truth for current phase progress, experiment ranges, phase results
- `jq '.agenda.phases | length' <slice-dir>/CAMPAIGN.json` — quick check that agenda was written
- `grep phaseIndex <slice-dir>/EXPERIMENT-LOG.jsonl` — verify phase attribution in experiment log

### What assumptions changed
- Original plan estimated ~95+ assertions across 3 test files — actual was 212 (106 + 61 + 45), roughly 2x the estimate. The agenda module's pure-function design made thorough testing straightforward.
