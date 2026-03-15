# S01: Compute Backend Interface & Local Backend — Research

**Date:** 2026-03-15

## Summary

The insertion point for the compute backend abstraction is clean and well-bounded. `runEval()` in `eval-runner.ts` (line 41) is called from exactly one place — `runExperimentPostProcess()` (line 595) — and has no external callers outside tests. The existing `RunEvalResult` interface already defines the contract that all backends must produce. The refactoring introduces a `ComputeBackend` interface, a `LocalBackend` that wraps the existing `spawnSync` logic, and a `resolveBackend()` factory — all in a new `compute-backend.ts` module.

The primary risk is **breaking backward compatibility**. 104 existing tests (73 eval-runner + 31 target-file-validation) must pass unchanged. Since `runEval` is only called internally, the strategy is: extract the existing logic into `LocalBackend`, make `runExperimentPostProcess` dispatch through the backend interface, and default to `LocalBackend` when no compute config is present. External function signatures don't change — the backend resolution happens inside `runExperimentPostProcess`.

The synchronous execution requirement (D064, technical constraints) is a hard constraint. `spawnSync` blocks the caller today; `ComputeBackend.runEval()` must also block. This is straightforward for `LocalBackend` and feasible for SSH/Docker in later slices via `spawnSync('ssh ...')` and `spawnSync('docker exec ...')`.

## Recommendation

**New module `compute-backend.ts`** with:
- `ComputeBackend` interface: `runEval(opts: ComputeEvalOpts): RunEvalResult`
- `ComputeEvalOpts` type: `{ command: string, timeoutSecs: number, cwd: string, env?: Record<string, string> }`
- `LocalBackend` class: wraps existing `spawnSync` logic from current `runEval()`
- `resolveBackend(config?: ComputeConfig): ComputeBackend` factory: returns `LocalBackend` for absent/local config, future backends for SSH/Docker
- `ComputeConfig` discriminated union added to `types.ts` on `CampaignConfig`

**Refactoring in `eval-runner.ts`**:
- The existing `runEval()` function stays exported (backward compat for tests that call it directly)
- `runExperimentPostProcess()` reads `config.compute`, calls `resolveBackend()`, and dispatches through the backend
- No signature changes to `runExperimentPostProcess()` — backend resolution is internal

This follows the pattern established by `simplicity-scorer.ts` (separate module, wired into eval pipeline) and `mlops-integration.ts` (optional integration based on config).

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Subprocess execution with timeout | `spawnSync` from `node:child_process` (already used in `runEval`) | Proven, synchronous, handles signals and timeouts natively |
| Interface/factory pattern | `BashOperations` in `packages/pi-coding-agent/src/core/tools/bash.ts` | Same concept: pluggable command execution with a default local implementation |
| Optional integration wiring | `MLOpsClient` interface in `mlops-integration.ts` | Pattern: create client if config present, non-fatal hooks, interface + concrete implementations |
| Config parsing with optional fields | `parseCampaignConfig()` in `state.ts` | Existing validation of `CampaignConfig` — just add optional `compute` field |

## Existing Code and Patterns

- `src/resources/extensions/gsd/eval-runner.ts:41` — `runEval()` is the exact function to wrap. Uses `spawnSync` with shell, timeout (secs * 1000), maxBuffer 10MB, cwd, encoding utf-8. Returns `RunEvalResult { stdout, stderr, exitCode, signal, timedOut }`.
- `src/resources/extensions/gsd/eval-runner.ts:518` — `runExperimentPostProcess()` is the orchestrator. Calls `runEval` in a loop (line 595). Reads campaign config internally (line 532). This is where backend dispatch happens.
- `src/resources/extensions/gsd/eval-runner.ts:29` — `RunEvalResult` interface. This is the contract backends must produce. Already exported, already used in tests. **Must not change.**
- `src/resources/extensions/gsd/types.ts:280` — `CampaignConfig` interface. Where `compute?: ComputeConfig` field gets added. Currently has `mlops?` and `agenda?` optional fields as precedent.
- `src/resources/extensions/gsd/state.ts:77` — `parseCampaignConfig()`. Does minimal shape validation (required fields only). Optional fields pass through via `as CampaignConfig` cast. The `compute` field will pass through the same way.
- `src/resources/extensions/gsd/mlops-integration.ts` — Pattern for `interface → concrete class → factory wired to config`. Circuit breaker pattern useful for future remote backends (S03/S04).
- `packages/pi-coding-agent/src/core/tools/bash.ts:63` — `BashOperations` interface. Prior art for pluggable exec. Uses async (Promise-based); our interface must be synchronous.
- `src/resources/extensions/gsd/auto.ts:627` — Call site in auto.ts that invokes `runExperimentPostProcess`. Does NOT pass compute config. This doesn't need to change since `runExperimentPostProcess` reads config internally.

## Constraints

- **Synchronous execution** — `runEval()` is synchronous (`spawnSync`). All callers assume this. The `ComputeBackend` interface must be synchronous. This means `ComputeBackend.runEval()` returns `RunEvalResult`, not `Promise<RunEvalResult>`. Future SSH/Docker backends use `spawnSync('ssh ...')` and `spawnSync('docker ...')` respectively.
- **`RunEvalResult` interface is frozen** — Tests and all consumers depend on `{ stdout, stderr, exitCode, signal, timedOut }`. Backends produce this exact shape.
- **No signature changes to `runExperimentPostProcess`** — Called from `auto.ts:627` and two test files. The backend resolution must happen internally via config reading.
- **`parseCampaignConfig` uses passthrough validation** — Optional fields aren't validated at the parse site. `ComputeConfig` validation happens in `resolveBackend()`, not in the parser.
- **All 104 existing tests must pass unchanged** — 73 eval-runner + 31 target-file-validation. These test `runEval` directly and `runExperimentPostProcess` with real subprocesses. No mocking in existing tests.
- **Native CLI binaries for remote backends** (D064) — No Node.js SSH/Docker client libraries. Keeps dependency footprint zero.

## Common Pitfalls

- **Breaking `runEval` export** — Tests import `runEval` directly. It must stay exported with the same signature. The backend abstraction goes _around_ it (LocalBackend delegates to it), not _in place of_ it.
- **Making the interface async** — Tempting to use `Promise<RunEvalResult>` for future flexibility, but the entire eval pipeline is synchronous. Async would cascade changes through `runExperimentPostProcess`, `handleAgentEnd` in auto.ts, and the experiment loop. Huge blast radius for zero immediate benefit. SSH/Docker can use `spawnSync` just fine.
- **Over-designing ComputeConfig** — S01 only needs the type discriminant and `{ type: 'local' }` (or absent = local). SSH and Docker config shapes are added in S03/S04. Keep the discriminated union minimal now.
- **Coupling `resolveBackend()` to SSH/Docker** — S01 should not import or reference SSH/Docker backends. `resolveBackend()` handles `'local'` and `undefined`; throws for unknown types. S05 wires up the full registry.
- **Env var forwarding** — `ComputeEvalOpts` includes `env?: Record<string, string>` for future remote backends that need environment setup. `LocalBackend` passes it through to `spawnSync` as `process.env` override. Don't forget this — it's in the boundary map.

## Open Risks

- **`spawnSync` env override behavior** — When `env` is provided to `spawnSync`, it completely replaces `process.env` rather than merging. `LocalBackend` needs to merge `{ ...process.env, ...opts.env }` if env is provided. Not a showstopper but easy to get wrong.
- **Test isolation for backend tests** — New contract tests for `ComputeBackend` + `LocalBackend` run real subprocesses (same as existing `runEval` tests). Must handle temp dirs and cleanup properly.
- **Future backend registration** — `resolveBackend()` currently throws for unknown types. When SSH/Docker are added (S03/S04), this function must be updated. Design for extensibility: a switch/case on `config.type` is sufficient — no need for a plugin registry.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript interface design | addyosmani/agent-skills@api-and-interface-design | available — not installed (tangential, not needed for this work) |

No external libraries, frameworks, or services involved. This slice is pure internal refactoring with interface design.

## Sources

- Existing `eval-runner.ts` at `src/resources/extensions/gsd/eval-runner.ts` — `runEval()` line 41, `runExperimentPostProcess()` line 518
- Existing `types.ts` at `src/resources/extensions/gsd/types.ts` — `RunEvalResult` line 29, `CampaignConfig` line 280
- `BashOperations` prior art at `packages/pi-coding-agent/src/core/tools/bash.ts` line 63
- `MLOpsClient` pattern at `src/resources/extensions/gsd/mlops-integration.ts`
- M004 Roadmap boundary map — `ComputeBackend`, `ComputeEvalOpts`, `LocalBackend`, `resolveBackend()` contracts
- Decisions D062 (scope), D063 (git sync), D064 (native CLI), D066 (failure → discard)
