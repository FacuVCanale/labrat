---
estimated_steps: 5
estimated_files: 3
---

# T01: Create ComputeBackend interface, LocalBackend, and contract tests

**Slice:** S01 — Compute Backend Interface & Local Backend
**Milestone:** M004

## Description

Create the `ComputeBackend` abstraction layer that all compute backends will implement. This includes the interface itself, the `LocalBackend` that wraps the existing `spawnSync` logic, the `resolveBackend()` factory, and the `ComputeConfig` type on `CampaignConfig`. Contract tests prove the abstraction works before it's wired into the eval pipeline.

The existing `runEval()` function stays exported and unchanged — `LocalBackend` replicates its logic internally rather than delegating to it, because future backends (SSH, Docker) won't use `runEval()`. This keeps the interface clean and the existing function as a stable API for tests that import it directly.

## Steps

1. Add `ComputeConfig` discriminated union to `types.ts` on `CampaignConfig`:
   - `ComputeConfig = { type: 'local' }` — minimal for S01. SSH/Docker shapes added in S03/S04.
   - `compute?: ComputeConfig` on `CampaignConfig` (optional, absent = local).

2. Create `compute-backend.ts` with:
   - `ComputeEvalOpts` type: `{ command: string, timeoutSecs: number, cwd: string, env?: Record<string, string> }`
   - `ComputeBackend` interface: `{ runEval(opts: ComputeEvalOpts): RunEvalResult }`
   - `LocalBackend` class implementing `ComputeBackend`: uses `spawnSync` with shell, timeout (secs × 1000), maxBuffer 10MB, cwd, encoding utf-8. Merges `{ ...process.env, ...opts.env }` when env provided, omits env param when not (inherits process.env by default).
   - `resolveBackend(config?: ComputeConfig): ComputeBackend` factory: returns `new LocalBackend()` for `undefined` or `{ type: 'local' }`, throws descriptive error for unknown types.

3. Write `tests/compute-backend.test.ts` with contract tests:
   - `LocalBackend.runEval()` — successful command returns stdout, exitCode 0, no signal, not timedOut
   - `LocalBackend.runEval()` — failing command returns stderr, non-zero exitCode
   - `LocalBackend.runEval()` — timeout returns timedOut true, signal is SIGTERM
   - `LocalBackend.runEval()` — env merging: custom env var is visible to subprocess, process.env vars still accessible
   - `LocalBackend.runEval()` — no env: subprocess inherits process.env
   - `resolveBackend()` — undefined config returns LocalBackend instance
   - `resolveBackend()` — `{ type: 'local' }` returns LocalBackend instance
   - `resolveBackend()` — unknown type throws with descriptive message
   - Interface contract: result matches `RunEvalResult` shape (stdout, stderr, exitCode, signal, timedOut)

## Must-Haves

- [ ] `ComputeBackend` interface is synchronous (returns `RunEvalResult`, not `Promise`)
- [ ] `LocalBackend` produces identical output to existing `runEval()` for same inputs
- [ ] `resolveBackend()` handles undefined, `{ type: 'local' }`, and unknown types
- [ ] `ComputeConfig` on `CampaignConfig` is optional — absent configs parse identically
- [ ] Env merging: `{ ...process.env, ...opts.env }` when env provided, omit env param when not
- [ ] All contract tests pass

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts` passes with 0 failures
- `LocalBackend.runEval({ command: 'echo hello', timeoutSecs: 10, cwd: tmpDir })` returns `{ stdout: 'hello\n', stderr: '', exitCode: 0, signal: null, timedOut: false }`

## Observability Impact

- **New failure surface**: `resolveBackend()` throws with descriptive error including the unknown type value — agents debugging config issues can grep for `"Unsupported compute backend type"`.
- **Structured subprocess diagnostics**: `LocalBackend.runEval()` returns `RunEvalResult` with `timedOut`, `signal`, `exitCode`, `stderr` — all machine-readable. No string parsing needed to distinguish timeout vs crash vs success.
- **Inspection**: `instanceof LocalBackend` check works for runtime type verification. `resolveBackend()` is deterministic — same config always produces the same backend type.

## Inputs

- `src/resources/extensions/gsd/types.ts` — `RunEvalResult` interface (line 29), `CampaignConfig` interface (line 280)
- `src/resources/extensions/gsd/eval-runner.ts` — existing `runEval()` implementation (line 41) as reference for spawnSync params
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing test patterns (custom assert, temp dirs, cleanup)
- S01-RESEARCH.md — constraints on synchronous execution, env override behavior, frozen RunEvalResult

## Expected Output

- `src/resources/extensions/gsd/compute-backend.ts` — new module with interface, LocalBackend, resolveBackend, ComputeEvalOpts
- `src/resources/extensions/gsd/types.ts` — `ComputeConfig` type added, `compute?` field on CampaignConfig
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — ~9 contract tests covering the full interface
