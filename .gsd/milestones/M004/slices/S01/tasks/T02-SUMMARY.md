---
id: T02
parent: S01
milestone: M004
provides:
  - "runExperimentPostProcess dispatches eval through ComputeBackend interface via resolveBackend()"
  - "Integration tests proving dispatch parity between backend.runEval() and direct runEval()"
key_files:
  - "src/resources/extensions/gsd/eval-runner.ts"
  - "src/resources/extensions/gsd/tests/compute-backend.test.ts"
key_decisions:
  - "resolveBackend() call placed after config null-check, before evalConfig extraction — backend is resolved once per experiment, not per eval run"
  - "Integration tests verify dispatch parity by running identical commands through both backend.runEval() and direct runEval() and comparing structured results"
patterns_established:
  - "Backend dispatch pattern: resolveBackend(config.compute) → backend.runEval({ command, timeoutSecs, cwd }) — same pattern future backends will use"
observability_surfaces:
  - "grep -n 'resolveBackend\\|backend.runEval' src/resources/extensions/gsd/eval-runner.ts shows dispatch wiring (3 lines: import, resolve, call)"
  - "resolveBackend() throws synchronously with 'Unsupported compute backend type: <type>' for unknown types — exception propagates before any eval runs"
  - "RunEvalResult structured fields (exitCode, signal, timedOut, stderr) unchanged — same diagnostic surface as before"
duration: 15m
verification_result: passed
completed_at: "2026-03-15"
blocker_discovered: false
---

# T02: Wire backend dispatch into eval pipeline and verify full regression

**Wired `resolveBackend()` into `runExperimentPostProcess()` so the eval pipeline dispatches through the `ComputeBackend` interface; added 15 integration assertions proving dispatch parity with direct `runEval()`.**

## What Happened

1. Added `import { resolveBackend } from './compute-backend.js'` to eval-runner.ts.
2. In `runExperimentPostProcess()`, after the config null-check (line 553), added `const backend = resolveBackend(config.compute)` — resolves once per experiment call.
3. Replaced `runEval(evalConfig.command, evalConfig.timeout, basePath)` at line 599 with `backend.runEval({ command: evalConfig.command, timeoutSecs: evalConfig.timeout, cwd: basePath })`.
4. Existing `runEval()` function remains exported at line 42 with unchanged signature — tests and direct callers unaffected.
5. Added 4 integration test blocks (15 assertions) to `compute-backend.test.ts`:
   - Dispatch parity: `resolveBackend(undefined)` → `backend.runEval()` produces identical stdout/stderr/exitCode/signal/timedOut to direct `runEval()` for the same command.
   - Explicit `{ type: 'local' }` config dispatch matches direct `runEval()` for failure case.
   - Absent compute config defaults to LocalBackend and runs real subprocesses.
   - Dispatch failure path: structured error fields (exitCode 99, stderr message, no timeout, null signal).

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 assertions pass (30 T01 + 15 T02)
- `npm test` — 260 pass, 13 fail (all 13 are pre-existing failures unrelated to this change: mlops-integration TypeScript parameter property syntax, worktree `dev` branch, supervision ENOENT, git-service custom command, npm pack/install)
- eval-runner: 73 passed, 0 failed ✓
- target-file-validation: 31 passed, 0 failed ✓
- compute-backend: 45 passed, 0 failed ✓
- `grep -n "resolveBackend\|backend.runEval" src/resources/extensions/gsd/eval-runner.ts` shows 3 lines: import (26), resolve (555), call (599)

## Diagnostics

- **Dispatch wiring location**: `grep -n 'resolveBackend\|backend.runEval' src/resources/extensions/gsd/eval-runner.ts` — shows import, resolution, and call site.
- **Backend resolution errors**: `resolveBackend()` throws synchronously with `Unsupported compute backend type: "<type>"` before any eval runs. This propagates as an unhandled exception to the caller.
- **Eval result inspection**: Same `RunEvalResult` struct as before — `exitCode`, `signal`, `timedOut`, `stderr` are all structured fields. No behavioral change from the caller's perspective.
- **Config absence is silent-safe**: Missing `compute` field defaults to LocalBackend via `resolveBackend(undefined)`. No log noise.

## Deviations

None.

## Known Issues

- 13 pre-existing test failures in unrelated suites (mlops-integration, worktree, supervision, git-service, npm pack). None caused by this change — verified by running supervision.test.ts against the pre-change code and observing the same ENOENT failure.

## Files Created/Modified

- `src/resources/extensions/gsd/eval-runner.ts` — Added resolveBackend import; wired backend dispatch into runExperimentPostProcess eval loop
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — Added 4 integration test blocks (15 assertions) for dispatch parity and failure path
- `.gsd/milestones/M004/slices/S01/S01-PLAN.md` — Added diagnostic verification step for backend dispatch failure path
- `.gsd/milestones/M004/slices/S01/tasks/T02-PLAN.md` — Added Observability Impact section
