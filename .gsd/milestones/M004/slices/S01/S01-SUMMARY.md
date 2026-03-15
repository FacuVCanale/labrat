---
id: S01
parent: M004
milestone: M004
provides:
  - ComputeBackend interface with synchronous runEval(opts) → RunEvalResult
  - ComputeEvalOpts type (command, timeoutSecs, cwd, env?)
  - LocalBackend class wrapping spawnSync with env merging
  - resolveBackend() factory with exhaustive type checking
  - ComputeConfig discriminated union on CampaignConfig (optional, absent = local)
  - Eval pipeline dispatch through ComputeBackend in runExperimentPostProcess
requires: []
affects:
  - S02
  - S03
  - S04
  - S05
key_files:
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/compute-backend.test.ts
key_decisions:
  - "D067: LocalBackend replicates spawnSync logic internally rather than delegating to runEval() — keeps interface clean for future SSH/Docker backends"
  - "resolveBackend uses TypeScript exhaustiveness guard (never type) so new ComputeConfig variants produce compile errors if unhandled"
  - "resolveBackend() called once per experiment in runExperimentPostProcess, after config null-check and before eval loop"
  - "Existing runEval() export preserved unchanged — tests and direct callers unaffected"
patterns_established:
  - "ComputeBackend interface — synchronous runEval(opts: ComputeEvalOpts): RunEvalResult"
  - "resolveBackend factory — config → backend instance with exhaustive type discrimination"
  - "Backend dispatch in pipeline — resolveBackend(config.compute) → backend.runEval({ command, timeoutSecs, cwd })"
observability_surfaces:
  - "resolveBackend() throws 'Unsupported compute backend type: \"<type>\"' for unknown config types"
  - "LocalBackend.runEval() returns structured RunEvalResult with timedOut, signal, exitCode, stderr"
  - "grep -n 'resolveBackend\\|backend.runEval' eval-runner.ts shows dispatch wiring (3 lines)"
drill_down_paths:
  - .gsd/milestones/M004/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T02-SUMMARY.md
duration: 30m
verification_result: passed
completed_at: 2026-03-15
---

# S01: Compute Backend Interface & Local Backend

**Pluggable ComputeBackend abstraction with LocalBackend default, resolveBackend factory, and eval pipeline dispatch — all 104+ existing tests pass unchanged.**

## What Happened

Created `compute-backend.ts` with the `ComputeBackend` interface (synchronous `runEval`), `ComputeEvalOpts` type, `LocalBackend` class, and `resolveBackend()` factory. LocalBackend replicates the existing `spawnSync` behavior from `runEval()` with proper env merging (`{ ...process.env, ...opts.env }` when env provided, inherits process.env when not). The factory uses TypeScript exhaustiveness checking so adding a new `ComputeConfig` variant without handling it is a compile error.

Added `ComputeConfig = { type: 'local' }` discriminated union to `types.ts` with optional `compute?` field on `CampaignConfig`. Absent = local, preserving backward compatibility.

Wired the dispatch into `runExperimentPostProcess()` in eval-runner.ts: after reading campaign config, `resolveBackend(config.compute)` resolves the backend once per experiment, then `backend.runEval()` replaces the direct `runEval()` call. The existing `runEval()` function stays exported with unchanged signature.

45 contract + integration test assertions across 13 test groups covering: success/failure/timeout, env merging/inheritance, factory routing, RunEvalResult shape, dispatch parity with direct runEval(), and structured error fields.

## Verification

- `compute-backend.test.ts` — 45 assertions passed, 0 failed ✅
- `npm test` — 260 pass, 13 fail (all 13 pre-existing in unrelated suites: mlops-integration, worktree, supervision, git-service, npm pack)
- eval-runner: 73 passed, 0 failed ✅
- target-file-validation: 31 passed, 0 failed ✅
- compute-backend: 45 passed, 0 failed ✅
- `resolveBackend({ type: 'bogus' as any })` throws descriptive error ✅
- Timeout test confirms `timedOut: true` and `signal: 'SIGTERM'` in result struct ✅

## Requirements Advanced

- R027 (Compute Backend Interface) — Interface created with LocalBackend default, resolveBackend factory, contract tests proving the abstraction works
- R030 (Eval Pipeline Integration) — runExperimentPostProcess dispatches through ComputeBackend; same RunEvalResult shape returned transparently
- R034 (Backend Failure Handling) — LocalBackend surfaces structured error fields (exitCode, signal, timedOut, stderr); resolveBackend throws descriptively for unknown types
- R035 (Eval Timeout Forwarding) — LocalBackend forwards timeoutSecs to spawnSync; timeout produces timedOut:true + SIGTERM signal

## Requirements Validated

- R027 — ComputeBackend interface exists with LocalBackend implementation, resolveBackend factory, and 45 contract/integration tests proving the abstraction works for local execution
- R030 — Eval pipeline dispatches through backend; all 73 eval-runner tests pass unchanged proving transparent integration

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Only `LocalBackend` implemented — SSH and Docker backends are S03 and S04
- `ComputeConfig` only has `{ type: 'local' }` variant — backend-specific config fields come in S03–S05
- Backend errors from `resolveBackend()` propagate as unhandled exceptions — S05 will add graceful discard wrapping

## Follow-ups

- none — all planned work completed as specified

## Files Created/Modified

- `src/resources/extensions/gsd/compute-backend.ts` — new module: ComputeBackend interface, ComputeEvalOpts type, LocalBackend class, resolveBackend factory
- `src/resources/extensions/gsd/types.ts` — added ComputeConfig discriminated union and compute? field on CampaignConfig
- `src/resources/extensions/gsd/eval-runner.ts` — wired resolveBackend import and backend dispatch into runExperimentPostProcess
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — 13 test groups, 45 assertions covering full interface contract and dispatch parity

## Forward Intelligence

### What the next slice should know
- `ComputeBackend` interface is synchronous — `runEval()` blocks and returns `RunEvalResult`. Future backends must also block (SSH waits for remote command, Docker waits for container exit).
- `resolveBackend()` is the single factory entry point. Add new backend types by extending the `ComputeConfig` union in types.ts and adding a case in resolveBackend()'s switch.
- The exhaustiveness guard (`const _exhaustive: never = config`) means a new ComputeConfig variant without a resolveBackend case is a compile error.

### What's fragile
- `runExperimentPostProcess` dispatch is at line ~555/599 in eval-runner.ts — if auto.ts or the eval pipeline is refactored, the backend.runEval() call site needs to move with it
- The `runEval()` export (line 42) is now technically dead code in the pipeline path but must stay — tests import it directly

### Authoritative diagnostics
- `grep -n 'resolveBackend\|backend.runEval' src/resources/extensions/gsd/eval-runner.ts` — shows the 3 dispatch wiring lines
- `node --experimental-strip-types -e "import { resolveBackend } from './src/resources/extensions/gsd/compute-backend.ts'; resolveBackend({ type: 'bogus' })"` — proves error message format

### What assumptions changed
- None — implementation matched the plan exactly
