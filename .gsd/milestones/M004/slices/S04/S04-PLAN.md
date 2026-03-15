# S04: Docker Compute Backend

**Goal:** `DockerBackend` runs eval inside a Docker container (local or remote daemon) with optional GPU passthrough, returning the same `RunEvalResult` shape as all other backends.
**Demo:** Contract tests prove: successful eval, failure forwarding, timeout (exit 124), daemon error (exit 125), GPU flag inclusion, env forwarding, volume mount args (local), git clone path (remote), missing-repoUrl error, safety-net timeout, and factory routing — all via mock docker binary.

## Must-Haves

- `DockerBackend` class implementing `ComputeBackend.runEval()` via `spawnSync('docker', ...)`
- Local path: volume-mount repo at `/workspace`, no git push needed
- Remote path (`dockerHost` set): `pushExperimentBranch()` + git clone inside container, requires `repoUrl` in config
- `--gpus` flag included when configured, omitted otherwise
- Docker exit code mapping: 124=timeout, 125=daemon error, 126=command not invokable, 127=command not found
- Safety-net spawnSync timeout with +60s buffer (Docker startup overhead)
- Env vars forwarded via `-e KEY=VALUE` flags
- `ComputeConfig` union extended with Docker variant
- `resolveBackend()` routes `type: 'docker'` to `DockerBackend`
- Contract tests using mock docker script (not real Docker) prove full behavior matrix

## Proof Level

- This slice proves: contract
- Real runtime required: no (mock docker binary — Docker not available in CI/test)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — all assertions pass, 0 failures
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — existing 45 assertions still pass (no regression)
- `npm run build` — compiles clean (no new type errors introduced by Docker additions)

## Observability / Diagnostics

- Runtime signals: `RunEvalResult.stderr` contains Docker diagnostic output on daemon error (exit 125), command error (126/127), and push failure
- Inspection surfaces: `grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts` shows all exit code mapping sites
- Failure visibility: Push errors prefixed with `"Code sync failed:"`, Docker daemon errors surface native stderr, missing `repoUrl` produces actionable error message
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `ComputeBackend` + `ComputeEvalOpts` from compute-backend.ts, `RunEvalResult` from eval-runner.ts, `ComputeConfig` from types.ts, `pushExperimentBranch()` from code-sync.ts, `runGit()` from git-service.ts
- New wiring introduced in this slice: `DockerBackend` import + `case 'docker'` in resolveBackend()
- What remains before the milestone is truly usable end-to-end: S05 (config parsing, credential validation, integration test)

## Tasks

- [x] **T01: Implement DockerBackend with local and remote paths** `est:30m`
  - Why: Core implementation — the Docker backend class, type extension, and factory wiring
  - Files: `src/resources/extensions/gsd/docker-backend.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/compute-backend.ts`
  - Do: Create `DockerBackend` class following SSHBackend's pattern. Two code paths in `runEval()`: local (volume mount, no push) vs remote (`pushExperimentBranch()` + git clone inside container). Build docker args (`run --rm -w /workspace`), env forwarding via `-e` flags, `--gpus` when configured, `timeout` wrapper inside container, safety-net spawnSync timeout (+60s). `mapDockerResult()` for exit code mapping (124/125/126/127/ETIMEDOUT/signal). Extend `ComputeConfig` union with Docker variant. Add `case 'docker'` to `resolveBackend()`. Duplicate `shellQuote()` locally (per research — don't extract shared module).
  - Verify: `npm run build` compiles clean; `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` still passes
  - Done when: DockerBackend class exists, compiles, factory routes to it, existing tests pass

- [x] **T02: Contract test suite with mock docker binary** `est:30m`
  - Why: Proves DockerBackend behavior without a real Docker daemon — tests argument assembly, exit code mapping, env forwarding, both code paths, and error handling
  - Files: `src/resources/extensions/gsd/tests/docker-backend.test.ts`
  - Do: Create mock docker shell script that captures args to a file and returns configurable exit codes. Prepend mock dir to `PATH` in tests. Test groups: successful eval (local), successful eval (remote with git clone), command failure exit code forwarding, timeout (exit 124), daemon error (exit 125), command not invokable (exit 126), command not found (exit 127), GPU flag inclusion/omission, env var forwarding in `-e` args, volume mount args (local path), remote path with repoUrl, missing repoUrl with dockerHost error, safety-net timeout (ETIMEDOUT/signal), extra volumes config, RunEvalResult shape for all outcome types, factory routing for `type: 'docker'`. Use `setupRepoWithBareRemote()` pattern for remote-path tests.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — all pass, 0 fail
  - Done when: Full behavior matrix covered, all assertions pass, test output shows pass/fail summary

## Files Likely Touched

- `src/resources/extensions/gsd/docker-backend.ts`
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/compute-backend.ts`
- `src/resources/extensions/gsd/tests/docker-backend.test.ts`
