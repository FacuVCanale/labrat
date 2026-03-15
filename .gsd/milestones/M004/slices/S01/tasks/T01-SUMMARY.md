---
id: T01
parent: S01
milestone: M004
provides:
  - ComputeBackend interface and ComputeEvalOpts type
  - LocalBackend class implementing synchronous subprocess execution
  - resolveBackend() factory for config-driven backend selection
  - ComputeConfig discriminated union on CampaignConfig
  - Contract test suite (30 assertions, 9 test groups)
key_files:
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/compute-backend.test.ts
key_decisions:
  - LocalBackend replicates spawnSync logic internally rather than delegating to runEval() — keeps interface clean for future SSH/Docker backends
  - Env merging uses spread when env provided, omits env param entirely when not (inherits process.env by default via spawnSync behavior)
  - resolveBackend uses TypeScript exhaustiveness guard (never type) so new ComputeConfig variants produce compile errors if unhandled
patterns_established:
  - ComputeBackend interface pattern — synchronous runEval(opts) returning RunEvalResult
  - resolveBackend factory pattern — config → backend instance with exhaustive type checking
observability_surfaces:
  - resolveBackend() throws with descriptive message including unknown type value for config debugging
  - LocalBackend.runEval() returns structured RunEvalResult with timedOut, signal, exitCode, stderr
duration: 15m
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T01: Create ComputeBackend interface, LocalBackend, and contract tests

**Created ComputeBackend abstraction with LocalBackend, resolveBackend factory, ComputeConfig type, and 30-assertion contract test suite.**

## What Happened

Added `ComputeConfig = { type: 'local' }` discriminated union to `types.ts` with an optional `compute?` field on `CampaignConfig`. Created `compute-backend.ts` with the `ComputeBackend` interface (synchronous `runEval`), `ComputeEvalOpts` type, `LocalBackend` class (replicates existing `spawnSync` params from `runEval()`), and `resolveBackend()` factory with exhaustiveness checking. Contract tests cover success/failure/timeout, env merging, env inheritance, factory routing for undefined/local/unknown, and RunEvalResult shape contract.

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts` — **30 assertions passed, 0 failed** ✅
- `npm test` — eval-runner tests (73 passed), research-types/CampaignConfig tests (33 passed), compute-backend tests (30 passed) all pass. Zero regression from types.ts change.
- Pre-existing failures in unrelated test files (mlops-integration TS syntax, worktree branch detection, supervision ENOENT) are unchanged — not caused by this task.

### Slice-level verification:
- ✅ `compute-backend.test.ts` — new contract tests pass (30/30)
- ⏳ `npm test` — all pre-existing passing tests still pass; pre-existing failures unchanged. Full regression passes after T02 wires the backend.

## Diagnostics

- `resolveBackend({ type: 'bogus' as any })` throws `Error: Unsupported compute backend type: "bogus"` — grep for this message in logs to diagnose config issues.
- `LocalBackend.runEval()` result has `timedOut`, `signal`, `exitCode`, `stderr` as structured fields — no string parsing needed.
- `instanceof LocalBackend` works for runtime type checking.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/compute-backend.ts` — new module with ComputeBackend interface, ComputeEvalOpts type, LocalBackend class, resolveBackend factory
- `src/resources/extensions/gsd/types.ts` — added ComputeConfig discriminated union and compute? field on CampaignConfig
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — 9 test groups, 30 assertions covering full interface contract
- `.gsd/milestones/M004/slices/S01/S01-PLAN.md` — added Observability/Diagnostics and diagnostic verification sections
- `.gsd/milestones/M004/slices/S01/tasks/T01-PLAN.md` — added Observability Impact section
