# S01: Compute Backend Interface & Local Backend — UAT

**Milestone:** M004
**Written:** 2026-03-15

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice is a pure code abstraction + wiring change with no user-facing UI. All behavior is verifiable through test execution and code inspection. The existing test suite is the primary regression proof.

## Preconditions

- Node.js available with `--experimental-strip-types` support
- Repository checked out with all dependencies installed (`npm install` completed)
- Working directory is the repository root

## Smoke Test

Run `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts` — all 45 assertions pass with 0 failures.

## Test Cases

### 1. LocalBackend executes subprocess and returns structured result

1. Run contract test suite: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/compute-backend.test.ts`
2. Observe "successful command returns stdout, exitCode 0, no signal, not timedOut" test
3. **Expected:** stdout contains the echoed string, exitCode is 0, signal is null, timedOut is false

### 2. LocalBackend handles subprocess failure with structured error

1. Same test suite as above
2. Observe "failing command returns stderr, non-zero exitCode" test
3. **Expected:** exitCode is non-zero (e.g., 1 or 99), stderr contains the error message, timedOut is false

### 3. LocalBackend enforces timeout with SIGTERM

1. Same test suite as above
2. Observe "timeout returns timedOut true, signal is SIGTERM" test
3. **Expected:** timedOut is true, signal is "SIGTERM", command is killed before it would naturally complete

### 4. LocalBackend merges env vars without replacing process.env

1. Same test suite as above
2. Observe "env merging: custom env var visible, process.env still accessible" test
3. **Expected:** Custom env var (e.g., `TEST_COMPUTE_VAR`) is visible to subprocess AND standard process.env vars (e.g., `PATH`) are still accessible

### 5. resolveBackend returns LocalBackend for absent config

1. Same test suite as above
2. Observe "undefined config returns LocalBackend instance" test
3. **Expected:** `resolveBackend(undefined)` returns an instance of LocalBackend (verified via instanceof)

### 6. resolveBackend returns LocalBackend for explicit local config

1. Same test suite as above
2. Observe "{ type: 'local' } returns LocalBackend instance" test
3. **Expected:** `resolveBackend({ type: 'local' })` returns an instance of LocalBackend

### 7. resolveBackend throws descriptively for unknown type

1. Same test suite as above
2. Observe "unknown type throws with descriptive message" test
3. **Expected:** `resolveBackend({ type: 'bogus' })` throws Error with message containing both "Unsupported compute backend type" and "bogus"

### 8. Dispatch parity — backend.runEval matches direct runEval

1. Same test suite as above
2. Observe "resolveBackend(undefined) dispatch matches direct runEval()" test
3. **Expected:** Running the same command through `resolveBackend(undefined).runEval()` and the direct `runEval()` function produces identical stdout, stderr, exitCode, signal, and timedOut values

### 9. Full regression — all eval-runner tests pass

1. Run: `npm test`
2. Observe eval-runner.test.ts results
3. **Expected:** All 73 eval-runner tests pass with 0 failures

### 10. Full regression — all target-file-validation tests pass

1. Run: `npm test`
2. Observe target-file-validation.test.ts results
3. **Expected:** All 31 target-file-validation tests pass with 0 failures

## Edge Cases

### Absent compute field on CampaignConfig

1. Observe that CampaignConfig in types.ts has `compute?` as optional
2. In contract tests, `resolveBackend(undefined)` is tested
3. **Expected:** Absent compute field defaults silently to LocalBackend — no errors, no log noise

### Empty env object passed to LocalBackend

1. Observe env merging contract test with `env: {}`
2. **Expected:** Subprocess still inherits full process.env — empty env object doesn't clear environment

### RunEvalResult shape contract

1. Observe "result matches RunEvalResult shape" test in contract suite
2. **Expected:** Result has exactly the fields: stdout (string), stderr (string), exitCode (number|null), signal (string|null), timedOut (boolean), durationMs (number), and durationMs >= 0

## Failure Signals

- Any of the 45 compute-backend assertions fail → interface contract broken
- Any of the 73 eval-runner tests fail → dispatch wiring broke backward compatibility
- `resolveBackend(undefined)` throws → default backend path broken, all campaigns without `compute` config will crash
- `grep -n 'resolveBackend\|backend.runEval' src/resources/extensions/gsd/eval-runner.ts` shows fewer or more than 3 lines → wiring may be incorrect or duplicated

## Requirements Proved By This UAT

- R027 (Compute Backend Interface) — Tests 1–7 prove the interface contract works with LocalBackend
- R030 (Eval Pipeline Integration) — Tests 8–10 prove eval dispatch through backend is transparent
- R034 (Backend Failure Handling) — Tests 2, 7 prove structured error surfaces
- R035 (Eval Timeout Forwarding) — Test 3 proves timeout is forwarded and enforced

## Not Proven By This UAT

- SSH backend execution (R028) — deferred to S03
- Docker backend execution (R029) — deferred to S04
- Git code sync before remote eval (R032) — deferred to S02
- Backend-specific configuration parsing (R031) — deferred to S05
- End-to-end campaign with remote compute config — deferred to S05

## Notes for Tester

- The 13 pre-existing test failures in `npm test` (mlops-integration, worktree, supervision, git-service, npm pack, etc.) are NOT caused by S01 changes. They existed before this slice and are tracked separately.
- The `runEval()` function export in eval-runner.ts is now bypassed in the pipeline (backend.runEval() is used instead) but must remain exported because tests import it directly. Do not remove it.
