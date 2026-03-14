---
estimated_steps: 6
estimated_files: 3
---

# T01: Agenda module with types, state persistence, and phase-transition functions

**Slice:** S02 — Research Agenda Planning & Execution
**Milestone:** M002

## Description

Create the `agenda.ts` module — the foundation for all agenda-related functionality in S02. This follows S01's module extraction pattern (D039): pure-function module with types and state I/O, called from auto.ts and guided-flow.ts. All agenda logic lives here — auto.ts gets only thin wiring calls.

The module provides: type definitions (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`), validation (`parseAgenda`), phase navigation (`getCurrentPhase`, `advancePhase`, `shouldAdvancePhase`), state persistence (`readAgendaState`, `writeAgendaState` with atomic writes), and helper functions for T02 integration (`getPhaseContext`, `getPhaseBestMetrics`, `getPhaseFilteredHistory`).

Extends `CampaignConfig` in `types.ts` with optional `agenda?: AgendaConfig`. This is zero-change to `parseCampaignConfig` — the field passes through via `as CampaignConfig` cast (same pattern as `simplicityWeight` from S01, decision D042).

## Steps

1. Define types in `agenda.ts`: `AgendaPhase` (name, dimension, experimentsPerPhase, goal, experimentPlans), `ExperimentPlan` (description, hypothesis, targetFocus), `AgendaConfig` (phases array, totalExperiments, researchQuestion), `AgendaState` (version, currentPhaseIndex, phaseResults map, experimentRanges map, completedPhases array). Add `agenda?: AgendaConfig` to `CampaignConfig` in `types.ts`.

2. Implement validation: `parseAgenda(raw: unknown): AgendaConfig | null` — validates required fields (phases must be non-empty array, each phase has name and experimentsPerPhase > 0, sum of experimentsPerPhase should not exceed maxExperiments when provided). Returns null on invalid input (graceful degradation pattern).

3. Implement state I/O: `readAgendaState(sliceDir: string): AgendaState | null` — reads `AGENDA-STATE.json`, returns null on missing/corrupt file (same pattern as `readBestMetrics`). `writeAgendaState(sliceDir: string, state: AgendaState): void` — write-to-temp-then-rename for atomicity (D041 pattern, preparing for S03's STEERING.json).

4. Implement phase navigation: `getCurrentPhase(state: AgendaState, config: AgendaConfig): AgendaPhase | null` — returns phase at currentPhaseIndex, null if all phases complete. `advancePhase(state: AgendaState, config: AgendaConfig, phaseMetrics: Record<string, number>): AgendaState` — increments phase index, records results, updates experiment ranges. `shouldAdvancePhase(state: AgendaState, phaseExperimentCount: number, config: AgendaConfig): boolean` — true when experiments in current phase reach the phase's `experimentsPerPhase`.

5. Implement T02 helper functions: `getPhaseContext(state: AgendaState, config: AgendaConfig): string` — formats current phase name, goal, dimension, remaining experiments into a markdown string (empty string when no agenda). `getPhaseBestMetrics(experiments: ExperimentResult[], state: AgendaState): Record<string, number> | null` — filters experiments to current phase's range, returns best kept metrics. `getPhaseFilteredHistory(experiments: ExperimentResult[], state: AgendaState): ExperimentResult[]` — returns only experiments from current phase.

6. Write comprehensive contract tests in `tests/agenda.test.ts` following the `simplicity-scorer.test.ts` pattern (assert/assertEq helpers, mkdtempSync, process exit code). Test groups: type validation (parseAgenda with valid/invalid inputs), state persistence (write/read round-trip, corrupt file recovery, missing file default, atomic write verification), phase transitions (advance through all phases, boundary detection, phase metrics recording), backward compatibility (CampaignConfig without agenda parses identically), helper functions (phase context formatting, phase-scoped metrics filtering, phase-filtered history).

## Must-Haves

- [ ] `AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState` types exported from `agenda.ts`
- [ ] `CampaignConfig.agenda` optional field in `types.ts` — zero change to `parseCampaignConfig`
- [ ] `parseAgenda` validates and returns null on invalid input
- [ ] `readAgendaState` / `writeAgendaState` with atomic writes (temp+rename) and graceful corruption recovery
- [ ] `getCurrentPhase` / `advancePhase` / `shouldAdvancePhase` for phase navigation
- [ ] `getPhaseContext` / `getPhaseBestMetrics` / `getPhaseFilteredHistory` helper functions for T02
- [ ] `AgendaState.version: 1` field for future migration
- [ ] Contract tests (50+ assertions) covering all functions
- [ ] Existing derive-state tests (33) still pass — backward compat proven

## Verification

- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` passes with 50+ assertions and exit code 0
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` passes with 33 assertions (unchanged)
- `npm run build` compiles clean with zero errors

## Inputs

- `src/resources/extensions/gsd/simplicity-scorer.ts` — module extraction pattern reference (D039)
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` type to extend
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig` (must not need changes)
- `src/resources/extensions/gsd/eval-runner.ts` — `readBestMetrics`, `readAllExperiments`, `compressExperimentHistory` patterns
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — test pattern reference

## Expected Output

- `src/resources/extensions/gsd/agenda.ts` — new module (~200 lines) with all types and functions
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` extended with `agenda?: AgendaConfig`
- `src/resources/extensions/gsd/tests/agenda.test.ts` — contract tests (50+ assertions)

## Observability Impact

- **New state file:** `AGENDA-STATE.json` in slice directory — tracks `version`, `currentPhaseIndex`, `phaseResults`, `experimentRanges`, `completedPhases`. Inspectable via `jq '.' AGENDA-STATE.json`.
- **Failure visibility:** `readAgendaState` returns null on missing/corrupt file with `console.error` warning to stderr. `parseAgenda` returns null on invalid config — no silent failures.
- **Diagnostic command:** `jq '.agenda.phases | length' CAMPAIGN.json` shows agenda phase count; `jq '.currentPhaseIndex' AGENDA-STATE.json` shows current phase.
- **Atomic writes:** `writeAgendaState` uses temp+rename — crash during write leaves previous valid state intact (no partial JSON).
