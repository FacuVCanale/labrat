# S01: Compute Backend Interface & Local Backend

**Goal:** `runEval()` dispatches through a `ComputeBackend` interface; existing local eval works identically via `LocalBackend`; all existing tests pass unchanged.
**Demo:** All 104 existing eval-runner + target-file-validation tests pass. New contract tests prove `ComputeBackend` interface, `LocalBackend`, and `resolveBackend()` work correctly. `runExperimentPostProcess` dispatches through the backend with zero behavioral change.

## Must-Haves

- `ComputeBackend` interface with synchronous `runEval(opts: ComputeEvalOpts): RunEvalResult`
- `ComputeEvalOpts` type: `{ command, timeoutSecs, cwd, env? }`
- `LocalBackend` wraps existing `spawnSync` logic, produces identical `RunEvalResult`
- `resolveBackend(config?)` factory returns `LocalBackend` for absent/local config, throws for unknown types
- `ComputeConfig` discriminated union on `CampaignConfig` (optional, absent = local)
- `runExperimentPostProcess` dispatches through backend — no signature changes
- Existing `runEval()` export stays unchanged (tests import it directly)
- `LocalBackend` merges `{ ...process.env, ...opts.env }` when env is provided (not replaces)
- All 104 existing tests pass unchanged

## Proof Level

- This slice proves: contract
- Real runtime required: yes (subprocess execution in contract tests)
- Human/UAT required: no

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts` — new contract tests pass
- `npm test` — all 104+ existing tests pass unchanged (zero regression)

## Integration Closure

- Upstream surfaces consumed: `RunEvalResult` (types.ts), `runEval()` (eval-runner.ts), `parseCampaignConfig()` (state.ts), `CampaignConfig` (types.ts)
- New wiring introduced in this slice: `resolveBackend()` called inside `runExperimentPostProcess`, backend.runEval() replaces direct `runEval()` call at line 595
- What remains before the milestone is truly usable end-to-end: S02 (git sync), S03 (SSH backend), S04 (Docker backend), S05 (config/credential wiring)

## Tasks

- [x] **T01: Create ComputeBackend interface, LocalBackend, and contract tests** `est:45m`
  - Why: The abstraction layer and its default implementation are the foundation — all later slices build on this interface. Contract tests prove the interface works before wiring it into the pipeline.
  - Files: `src/resources/extensions/gsd/compute-backend.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/compute-backend.test.ts`
  - Do: Create `compute-backend.ts` with `ComputeBackend` interface, `ComputeEvalOpts` type, `LocalBackend` class (delegates to `spawnSync` with same params as existing `runEval`), and `resolveBackend()` factory. Add `ComputeConfig` discriminated union to `types.ts` on `CampaignConfig`. LocalBackend must merge `{ ...process.env, ...opts.env }` when env provided. Write contract tests covering: LocalBackend success/failure/timeout, env merging, resolveBackend for undefined/local/unknown types, interface contract (RunEvalResult shape).
  - Verify: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts`
  - Done when: All contract tests pass; `LocalBackend.runEval()` produces identical results to existing `runEval()` for same inputs; `resolveBackend()` returns LocalBackend for absent/local config and throws for unknown types.

- [x] **T02: Wire backend dispatch into eval pipeline and verify full regression** `est:30m`
  - Why: The interface is useless until the pipeline actually uses it. This task closes the loop — `runExperimentPostProcess` dispatches through the backend, and the full test suite proves nothing broke.
  - Files: `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/tests/compute-backend.test.ts`
  - Do: In `runExperimentPostProcess`, after reading campaign config (line 532), call `resolveBackend(config?.compute)` to get the backend. Replace the direct `runEval()` call at line 595 with `backend.runEval({ command, timeoutSecs, cwd, env })`. Keep the existing `runEval()` function exported and unchanged. Add integration-level tests to compute-backend.test.ts verifying that `runExperimentPostProcess` works correctly with the backend dispatch (uses real subprocess, same pattern as existing orchestrator tests).
  - Verify: `npm test` — all existing tests plus new tests pass. Zero failures across eval-runner, target-file-validation, and compute-backend test suites.
  - Done when: `npm test` passes with 0 failures; `runExperimentPostProcess` dispatches through `ComputeBackend`; existing `runEval` export is unchanged.

## Observability / Diagnostics

- **resolveBackend() errors**: Unknown compute types throw with a descriptive message including the received type value — `Unsupported compute backend type: "<type>"`. This is inspectable in stderr of the eval pipeline and in experiment logs.
- **LocalBackend subprocess failures**: `RunEvalResult` surfaces `exitCode`, `signal`, `timedOut`, `stderr` — all structured fields, no string parsing needed. A future agent can check `timedOut` for timeout diagnosis, `signal` for kill signals, `exitCode` for process-level failures.
- **Config absence is silent-safe**: Missing `compute` field on `CampaignConfig` defaults to local execution. No log noise — absence is the normal case.
- **Redaction**: No secrets flow through `ComputeConfig` in S01. SSH credentials (S03) will need redaction when added.

## Verification (diagnostic)

- `resolveBackend({ type: 'bogus' as any })` throws with message containing `"bogus"` — confirms error messages are descriptive and inspectable
- Timeout test confirms `timedOut: true` and `signal: 'SIGTERM'` are surfaced in the result struct
- Backend dispatch failure path: `runExperimentPostProcess` with a failing eval command produces structured `exitCode` and `stderr` in `RunEvalResult` — no string parsing needed for diagnosis

## Files Likely Touched

- `src/resources/extensions/gsd/compute-backend.ts` (new)
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/eval-runner.ts`
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` (new)
