---
estimated_steps: 8
estimated_files: 4
---

# T01: Validate compute config, wrap backend errors, add pre-flight checks, and prove end-to-end integration

**Slice:** S05 — Configuration, Credentials & Integration
**Milestone:** M004

## Description

Single task closing the four remaining active requirements for M004. Adds compute config validation to `parseCampaignConfig()` so malformed backend configs are caught at load time. Wraps the `resolveBackend()` + `backend.runEval()` call site in try/catch so unexpected backend errors produce proper discard results with revert and JSONL logging. Adds lightweight pre-flight checks for SSH connectivity and Docker daemon reachability. Proves the full config → backend → eval → result pipeline with an integration test.

## Steps

1. In `state.ts`, add `validateComputeConfig(compute: unknown): boolean` after line 94. For `type: 'ssh'`: require `host` (string) and `workDir` (string). For `type: 'docker'`: require `image` (string). For `type: 'local'`: always valid. Unknown type or non-object: invalid. Call it from `parseCampaignConfig` — if `parsed.compute` exists and is not valid, return null.
2. In `compute-backend.ts`, add `checkSSHConnectivity(host: string): { ok: boolean; error?: string }` — runs `spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, 'true'])`, returns ok:true on exit 0, ok:false with stderr on failure. Add `checkDockerDaemon(dockerHost?: string): { ok: boolean; error?: string }` — runs `spawnSync('docker', dockerHost ? ['-H', dockerHost, 'info'] : ['info'])`, returns ok:true on exit 0, ok:false with stderr on failure.
3. In `eval-runner.ts` `runExperimentPostProcess()`: wrap lines 555–684 (resolveBackend through return result) in try/catch. The catch block constructs a discard ExperimentResult with `reason: 'backend error: <message>'`, calls `revertExperiment()`, calls `appendExperimentLog()`, returns the result. Same pattern as the "missing campaign config" early return at lines 534–552.
4. In `eval-runner.ts`, after `resolveBackend()` and before the eval loop: if backend is SSH or Docker, call the appropriate pre-flight check. If `!ok`, construct and return a discard ExperimentResult with the pre-flight error in the reason, revert, and log. Import the check functions from compute-backend.ts.
5. Write `tests/config-integration.test.ts` using the established test pattern (assert/assertEq helpers, pass/fail counter, process.exit(1) on failure). Test groups:
   - Config validation: SSH valid, SSH missing host, SSH missing workDir, Docker valid, Docker missing image, local valid, unknown type, compute absent (backward compat)
   - Pre-flight checks: mock ssh/docker binaries on PATH (same pattern as docker-backend.test.ts), success and failure paths
   - Error wrapping: mock a backend that throws, verify discard result shape
   - End-to-end dispatch: valid SSH config → resolveBackend returns SSHBackend instance, valid Docker config → DockerBackend instance
6. Run config-integration.test.ts and compute-backend.test.ts to verify no regressions.

## Must-Haves

- [ ] `parseCampaignConfig` returns null for SSH config missing host or workDir
- [ ] `parseCampaignConfig` returns null for Docker config missing image
- [ ] `parseCampaignConfig` returns null for unknown compute type
- [ ] `parseCampaignConfig` returns valid config when compute field is absent (backward compat)
- [ ] `parseCampaignConfig` returns valid config when compute is `{ type: 'local' }` 
- [ ] Backend throw in runExperimentPostProcess produces discard with revert + JSONL log
- [ ] `checkSSHConnectivity` returns structured `{ ok, error? }`
- [ ] `checkDockerDaemon` returns structured `{ ok, error? }`
- [ ] Pre-flight failure for SSH/Docker produces discard result before eval attempt
- [ ] Integration test passes with all assertions green
- [ ] compute-backend.test.ts still passes (45 assertions, no regression)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — all assertions pass
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 passed, 0 failed

## Observability Impact

- Signals added/changed: Pre-flight check errors in RunEvalResult.stderr with "Pre-flight failed:" prefix; backend error reason in discard result
- How a future agent inspects this: `grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error' state.ts eval-runner.ts compute-backend.ts`
- Failure state exposed: Invalid compute config → null from parseCampaignConfig → "missing or invalid campaign config" discard; backend throw → "backend error: <message>" discard; pre-flight failure → "Pre-flight failed: <error>" discard

## Inputs

- `src/resources/extensions/gsd/state.ts` — parseCampaignConfig at lines 77–99, insertion point after line 94
- `src/resources/extensions/gsd/eval-runner.ts` — runExperimentPostProcess at lines 519–684, dispatch at line 555
- `src/resources/extensions/gsd/compute-backend.ts` — resolveBackend at lines 72–88, LocalBackend/SSHBackend/DockerBackend imports
- `src/resources/extensions/gsd/types.ts` — ComputeConfig union at lines 305–308, ExperimentResult type
- S03/S04 test patterns — mock binary on PATH for SSH/Docker pre-flight tests

## Expected Output

- `src/resources/extensions/gsd/state.ts` — `validateComputeConfig()` added, called from parseCampaignConfig
- `src/resources/extensions/gsd/compute-backend.ts` — `checkSSHConnectivity()` and `checkDockerDaemon()` exported
- `src/resources/extensions/gsd/eval-runner.ts` — try/catch around backend dispatch, pre-flight calls for remote backends
- `src/resources/extensions/gsd/tests/config-integration.test.ts` — new test file with ~40+ assertions covering all paths
