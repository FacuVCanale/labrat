---
id: T01
parent: S03
milestone: M002
provides:
  - steering.ts module with atomic read/write/clear for STEERING.json and STEERING-FOCUS.md
  - SteeringDirective type in types.ts
  - checkSteeringDirective facade handling refocus, skip_phase, stop
  - getSteeringPromptOverride for prompt injection
key_files:
  - src/resources/extensions/gsd/steering.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/steering.test.ts
key_decisions:
  - Static import of readAllExperiments (no circular dep risk since eval-runner doesn't import steering)
  - Type validation in readSteeringDirective rejects unknown directive types at the read layer (defense in depth before facade switch)
patterns_established:
  - Steering module follows agenda.ts extraction pattern (D039): pure functions + facade, atomic I/O via D045
  - SteeringResult interface as facade return type with optional stop flag
observability_surfaces:
  - "[steering] Corrupt STEERING.json" stderr warning on parse failure
  - cat <slice-dir>/STEERING.json for pending directives
  - cat <slice-dir>/STEERING-FOCUS.md for active refocus context
duration: 12m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Create steering.ts module with types, atomic I/O, facade functions, and contract tests

**Steering module implemented with 76 contract test assertions covering all directive types, atomic I/O, graceful degradation, and facade behavior.**

## What Happened

Added `SteeringDirective` type to `types.ts` alongside existing `AgendaConfig`/`ExperimentResult`. Created `steering.ts` (~219 lines) following the `agenda.ts` extraction pattern with:

- File constants for `STEERING.json` and `STEERING-FOCUS.md`
- `readSteeringDirective` with shape validation (type must be one of refocus/skip_phase/stop), graceful JSON parse recovery returning null, stderr `[steering]` warning on corruption
- `writeSteeringDirective` with atomic write-to-temp-then-rename (D045)
- `clearSteeringDirective` / `clearSteeringFocus` — delete with no-op on missing
- `writeSteeringFocus` / `getSteeringPromptOverride` — persistent refocus context I/O, formatted markdown section for prompt injection
- `checkSteeringDirective` facade — reads directive, switches on type (refocus: writes focus + clears; skip_phase: advances phase via agenda.ts + clears both; stop: clears + returns stop flag), returns `SteeringResult` with notify message

For `skip_phase`: imports `readAgendaState`, `writeAgendaState`, `advancePhase`, `getCurrentPhase`, `getPhaseBestMetrics` from agenda.ts and `readAllExperiments` from eval-runner.ts. Degrades gracefully for non-agenda campaigns, missing agenda state, and all-phases-complete.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — **76 passed, 0 failed** (requirement: ≥45)
- `npm run build` — compiles clean, no type errors
- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — 106 passed, 0 failed (no regressions)
- `wc -l auto.ts` — 3269 (≤ 3275)
- Slice verification partial pass: steering.test.ts ✅, build ✅, auto.ts line count ✅, steering-command.test.ts ⏳ (T02)

## Diagnostics

- Corrupt STEERING.json: returns null with `[steering] Corrupt STEERING.json in <dir>` on stderr
- Inspect pending directives: `cat <slice-dir>/STEERING.json`
- Inspect active refocus: `cat <slice-dir>/STEERING-FOCUS.md`
- Verify agenda state after skip: `jq '.' <slice-dir>/AGENDA-STATE.json`

## Deviations

- steering.ts is 219 lines (estimated ~150) due to comprehensive validation and three graceful-degradation paths in skip_phase
- Test file is 584 lines (estimated ~250) due to 76 assertions (vs target ≥45) — more thorough coverage of edge cases

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/steering.ts` — new module with all steering I/O and facade functions
- `src/resources/extensions/gsd/types.ts` — added SteeringDirective interface
- `src/resources/extensions/gsd/tests/steering.test.ts` — 76 contract test assertions
- `.gsd/milestones/M002/slices/S03/S03-PLAN.md` — added failure-path diagnostic verification step
