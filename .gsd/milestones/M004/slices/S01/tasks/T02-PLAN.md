---
estimated_steps: 4
estimated_files: 3
---

# T02: Wire backend dispatch into eval pipeline and verify full regression

**Slice:** S01 — Compute Backend Interface & Local Backend
**Milestone:** M004

## Description

Wire `resolveBackend()` into `runExperimentPostProcess()` so the eval pipeline dispatches through the `ComputeBackend` interface instead of calling `runEval()` directly. The existing `runEval()` function stays exported and unchanged — it remains available for tests and any direct callers. This task closes the slice: after it, the pipeline uses the abstraction and all existing tests prove nothing broke.

## Steps

1. In `eval-runner.ts`, import `resolveBackend` and `LocalBackend` from `compute-backend.ts`. Import `ComputeConfig` from `types.ts` if needed for type annotation.

2. In `runExperimentPostProcess()`, after reading campaign config (line 532):
   - Call `resolveBackend(config?.compute)` to get the backend instance.
   - In the eval loop (line 594-616), replace `runEval(evalConfig.command, evalConfig.timeout, basePath)` with `backend.runEval({ command: evalConfig.command, timeoutSecs: evalConfig.timeout, cwd: basePath })`.
   - No other changes to `runExperimentPostProcess` — same signature, same return type, same everything.

3. Add integration-level test(s) to `compute-backend.test.ts`:
   - Verify that `runExperimentPostProcess` still produces correct results when dispatching through the backend (happy path — successful eval with real subprocess).
   - Verify backward compatibility: `runExperimentPostProcess` with no `compute` field in config works identically to before.

4. Run `npm test` and verify zero regressions across all test suites (eval-runner 73 tests, target-file-validation 31 tests, compute-backend new tests, and all others).

## Must-Haves

- [ ] `runExperimentPostProcess` dispatches eval through `resolveBackend()` → `backend.runEval()`
- [ ] Existing `runEval()` function remains exported with unchanged signature
- [ ] No signature changes to `runExperimentPostProcess`
- [ ] All 104+ existing tests pass unchanged (zero regression)
- [ ] Backend dispatch is transparent — absent `compute` config uses LocalBackend automatically

## Verification

- `npm test` passes with 0 failures across all test suites
- `grep -n "backend.runEval\|resolveBackend" src/resources/extensions/gsd/eval-runner.ts` shows the dispatch wiring

## Inputs

- `src/resources/extensions/gsd/compute-backend.ts` — from T01: `resolveBackend()`, `ComputeBackend`, `ComputeEvalOpts`
- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess()` at line 518, `runEval()` call at line 595
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` with `compute?` field from T01

## Expected Output

- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess` dispatches through backend interface
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — integration tests added
- `npm test` — all tests green

## Observability Impact

- **What changes:** `runExperimentPostProcess` now resolves a `ComputeBackend` via `resolveBackend(config?.compute)` before the eval loop. The eval call site switches from `runEval(command, timeout, cwd)` to `backend.runEval({ command, timeoutSecs, cwd })`. No new log lines; no new error paths — the backend call produces the same `RunEvalResult` struct.
- **How a future agent inspects this:** `grep -n "resolveBackend\|backend.runEval" src/resources/extensions/gsd/eval-runner.ts` shows exactly where the dispatch happens. The `backend` variable is scoped to `runExperimentPostProcess` — trace it from the `resolveBackend` call to the loop body.
- **Failure state visible:** If `config.compute` has an unsupported type, `resolveBackend()` throws synchronously before any eval runs — the exception propagates to the caller with `Unsupported compute backend type: "<type>"`. If evals fail, the same structured `RunEvalResult` fields (`exitCode`, `signal`, `timedOut`, `stderr`) are available as before.
