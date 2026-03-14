---
id: T01
parent: S02
milestone: M002
provides:
  - AgendaConfig, AgendaPhase, ExperimentPlan, AgendaState types
  - parseAgenda validation function
  - readAgendaState / writeAgendaState with atomic writes
  - getCurrentPhase / advancePhase / shouldAdvancePhase phase navigation
  - getPhaseContext / getPhaseBestMetrics / getPhaseFilteredHistory T02 helpers
  - createInitialAgendaState factory function
  - CampaignConfig.agenda optional field (backward compatible)
key_files:
  - src/resources/extensions/gsd/agenda.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/agenda.test.ts
key_decisions:
  - Agenda types defined in types.ts (consistent with all other types) and re-exported from agenda.ts
  - createInitialAgendaState computes experiment ranges upfront from phase config
  - getPhaseFilteredHistory uses experimentRanges from state (not config) for phase-scoping
patterns_established:
  - Atomic state file writes via temp+rename (D045 pattern for AGENDA-STATE.json)
  - Graceful degradation on corrupt/missing state files with stderr warnings
  - Immutable state updates in advancePhase (returns new state, does not mutate)
observability_surfaces:
  - AGENDA-STATE.json — inspectable via `jq '.' AGENDA-STATE.json`
  - readAgendaState stderr warnings on corruption — `[agenda] Corrupt AGENDA-STATE.json`
  - parseAgenda returns null on invalid input — no silent failures
duration: 15m
verification_result: passed
completed_at: 2026-03-14T14:41:00Z
blocker_discovered: false
---

# T01: Agenda module with types, state persistence, and phase-transition functions

**Created agenda.ts module with 4 type definitions, validation, atomic state I/O, phase navigation, and T02 helper functions — 106 test assertions passing.**

## What Happened

Created `agenda.ts` as a pure-function module following the D039 extraction pattern. Added agenda-related types (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`) to `types.ts` alongside existing types, with re-exports from `agenda.ts`. Extended `CampaignConfig` with optional `agenda?: AgendaConfig` field — zero changes needed to `parseCampaignConfig` (confirmed by 113 derive-state tests passing).

Implemented `parseAgenda` with validation of required fields, phase shape, and optional `maxExperiments` constraint. State I/O uses the D045 atomic write pattern (write-to-temp-then-rename). Phase navigation functions (`getCurrentPhase`, `advancePhase`, `shouldAdvancePhase`) use immutable state updates. T02 helpers (`getPhaseContext`, `getPhaseBestMetrics`, `getPhaseFilteredHistory`) are ready for prompt injection and phase-scoped experiment filtering.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — **106 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — **113 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73 passed, 0 failed** ✓
- `npm run build` — **exit code 0, zero errors** ✓

### Slice-level verification status (T01 of 3):
- ✅ `agenda.test.ts` — 106 assertions passing
- ⬜ `agenda-execution.test.ts` — not yet created (T02)
- ⬜ `plan-command.test.ts` — not yet created (T03)
- ✅ `derive-state.test.ts` — 113 passing (backward compat)
- ✅ `eval-runner.test.ts` — 73 passing (backward compat)
- ✅ `npm run build` — compiles clean

## Diagnostics

- **State file inspection:** `jq '.' <slice-dir>/AGENDA-STATE.json` shows current phase index, completed phases, experiment ranges, and phase results
- **Config inspection:** `jq '.agenda.phases | length' <slice-dir>/CAMPAIGN.json` shows agenda phase count
- **Failure visibility:** Corrupt/missing AGENDA-STATE.json produces `[agenda] Corrupt AGENDA-STATE.json` on stderr and returns null (graceful recovery)
- **Atomic writes:** Crash during writeAgendaState leaves previous valid state intact (temp file is renamed atomically)

## Deviations

- Types placed in `types.ts` rather than only in `agenda.ts` — follows the existing codebase pattern where all type definitions live in `types.ts`. Re-exported from `agenda.ts` for consumer convenience.
- Added `createInitialAgendaState` factory function not explicitly in the task plan — needed for clean state initialization with pre-computed experiment ranges.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/agenda.ts` — new module (~230 lines) with validation, state I/O, phase navigation, and T02 helpers
- `src/resources/extensions/gsd/types.ts` — added AgendaConfig, AgendaPhase, ExperimentPlan, AgendaState types; extended CampaignConfig with optional agenda field
- `src/resources/extensions/gsd/tests/agenda.test.ts` — contract tests with 106 assertions
- `.gsd/milestones/M002/slices/S02/S02-PLAN.md` — added diagnostic verification step (pre-flight fix)
- `.gsd/milestones/M002/slices/S02/tasks/T01-PLAN.md` — added Observability Impact section (pre-flight fix)
