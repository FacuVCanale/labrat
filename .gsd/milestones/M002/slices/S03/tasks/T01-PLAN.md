---
estimated_steps: 5
estimated_files: 3
---

# T01: Create steering.ts module with types, atomic I/O, facade functions, and contract tests

**Slice:** S03 — Runtime Steering
**Milestone:** M002

## Description

Create the `steering.ts` module following the `agenda.ts` pattern — types in `types.ts`, pure functions for atomic file I/O, facade functions for auto.ts consumption, and comprehensive contract tests. This task retires the core technical risk of concurrent file access between `labrat auto` and `labrat discuss` processes via the write-to-temp-then-rename pattern (D041/D045).

The module handles two files:
- `STEERING.json` — transient directive file, consumed and deleted at experiment boundary
- `STEERING-FOCUS.md` — persistent refocus context for prompt injection, survives across experiments

## Steps

1. Add `SteeringDirective` type to `types.ts` following the existing convention (alongside `AgendaConfig`, `ExperimentResult`). Type: `{ type: 'refocus' | 'skip_phase' | 'stop', message: string, timestamp: string, appliedAt?: string }`.

2. Create `steering.ts` module with:
   - File constants (`STEERING_FILE = 'STEERING.json'`, `STEERING_FOCUS_FILE = 'STEERING-FOCUS.md'`)
   - `readSteeringDirective(sliceDir)` — try/catch with graceful parse recovery, null on missing/corrupt/invalid-shape, stderr warning on corruption (matching `readAgendaState` pattern)
   - `writeSteeringDirective(sliceDir, directive)` — atomic write-to-temp-then-rename (matching `writeAgendaState` pattern)
   - `clearSteeringDirective(sliceDir)` — delete STEERING.json (no-op if missing)
   - `writeSteeringFocus(sliceDir, message)` — write STEERING-FOCUS.md with refocus message
   - `clearSteeringFocus(sliceDir)` — delete STEERING-FOCUS.md (no-op if missing)
   - `getSteeringPromptOverride(sliceDir)` — read STEERING-FOCUS.md, return formatted markdown section or empty string
   - `checkSteeringDirective(sliceDir, config)` — facade: read directive → switch on type → apply (refocus: writeSteeringFocus + clear; skip_phase: advancePhase from agenda.ts + clearSteeringFocus + clear; stop: clear + return stop flag) → return `{ notify: string, stop?: boolean } | null`

3. For `skip_phase` in the facade: import `readAgendaState`, `writeAgendaState`, `advancePhase`, `getCurrentPhase`, `getPhaseBestMetrics` from `agenda.ts` and `readAllExperiments` from `eval-runner.ts`. Handle non-agenda campaigns gracefully (warn + no-op). Handle all-phases-complete (warn + no-op).

4. Write `steering.test.ts` following `agenda.test.ts` pattern (assert/assertEq, temp directory, cleanup, process exit code). Test groups:
   - Write/read roundtrip for SteeringDirective
   - readSteeringDirective returns null on missing file, empty file, corrupt JSON, invalid shape (missing type/message/timestamp, wrong type value)
   - writeSteeringDirective creates atomic temp file (verify target file exists after write)
   - clearSteeringDirective removes file, no-op on missing
   - writeSteeringFocus/getSteeringPromptOverride roundtrip
   - getSteeringPromptOverride returns empty string when no file
   - clearSteeringFocus removes file, no-op on missing
   - checkSteeringDirective returns null when no directive
   - checkSteeringDirective type='stop' returns `{ notify, stop: true }` and clears file
   - checkSteeringDirective type='refocus' writes STEERING-FOCUS.md, clears STEERING.json, returns notify
   - checkSteeringDirective type='skip_phase' with agenda advances phase, clears both files, returns notify
   - checkSteeringDirective type='skip_phase' without agenda warns, returns notify, doesn't crash
   - Backward compat: checkSteeringDirective with null config handles refocus/stop correctly
   - Unknown directive type handled gracefully

5. Run tests and build to verify.

## Must-Haves

- [ ] `SteeringDirective` type in types.ts with `type: 'refocus' | 'skip_phase' | 'stop'`
- [ ] Atomic write-to-temp-then-rename for STEERING.json (D041)
- [ ] Graceful JSON parse error recovery returning null (never throws)
- [ ] `checkSteeringDirective` facade handles all three directive types
- [ ] `skip_phase` on non-agenda campaign degrades gracefully
- [ ] `getSteeringPromptOverride` returns empty string when no active refocus
- [ ] ≥ 45 contract test assertions passing

## Verification

- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — all assertions pass
- `npm run build` — compiles clean with no type errors

## Observability Impact

- Signals added: `[steering] Corrupt STEERING.json` stderr warning on parse failure (matching `[agenda]` pattern)
- How a future agent inspects this: `cat <slice-dir>/STEERING.json` for pending directives, `cat <slice-dir>/STEERING-FOCUS.md` for active refocus
- Failure state exposed: corrupt file → null return with stderr warning, never blocks experiments

## Inputs

- `src/resources/extensions/gsd/agenda.ts` — structural template (atomic I/O pattern, facade pattern), imported functions for skip_phase
- `src/resources/extensions/gsd/types.ts` — type definition convention (alongside AgendaConfig, ExperimentResult)
- `src/resources/extensions/gsd/tests/agenda.test.ts` — test pattern (assert/assertEq, temp dirs, cleanup)
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments` for skip_phase metrics

## Expected Output

- `src/resources/extensions/gsd/steering.ts` — new module (~150 lines) with all read/write/clear/facade functions
- `src/resources/extensions/gsd/types.ts` — SteeringDirective type added
- `src/resources/extensions/gsd/tests/steering.test.ts` — comprehensive contract tests (~250 lines, ≥45 assertions)
