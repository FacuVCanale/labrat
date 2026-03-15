# S04: Docker Compute Backend — UAT

**Milestone:** M004
**Written:** 2026-03-15

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: Docker is not available in the test/CI environment. All behavior is proven by contract tests using a mock docker binary that captures args and returns configurable exit codes. The mock tests the real spawnSync call path — only the docker binary itself is faked.

## Preconditions

- Repository checked out with S04 changes
- Node.js available, `npm run build` passes
- No real Docker installation required (tests use mock binary)

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — should print `79 tests: 79 passed, 0 failed` and exit 0.

## Test Cases

### 1. Local Docker Eval (Volume Mount)

1. Create a `DockerBackend` with config `{ type: 'docker', image: 'python:3.11' }` and no `dockerHost`
2. Call `runEval({ command: 'python eval.py', timeoutSecs: 300, cwd: '/my/project' })`
3. **Expected:** Docker args include `-v /my/project:/workspace`, `-w /workspace`, `--rm`, image `python:3.11`, and the command is wrapped in `sh -c 'timeout 300 python eval.py'`. No git push occurs.

### 2. Remote Docker Eval (Git Clone)

1. Create a `DockerBackend` with config `{ type: 'docker', image: 'node:20', dockerHost: 'tcp://gpu-box:2376', repoUrl: 'git@github.com:user/repo.git' }`
2. Call `runEval({ command: 'npm test', timeoutSecs: 60, cwd: '/local/path' })`
3. **Expected:** `pushExperimentBranch()` is called first. Docker args include `-H tcp://gpu-box:2376`. Command inside container includes `git clone git@github.com:user/repo.git /workspace && cd /workspace && git checkout <ref> && timeout 60 npm test`. No `-v` volume mount.

### 3. GPU Passthrough

1. Create a `DockerBackend` with config `{ type: 'docker', image: 'nvidia/cuda:12', gpus: 'all' }`
2. Call `runEval(...)` with any command
3. **Expected:** Docker args include `--gpus all`
4. Repeat with config that omits `gpus` field
5. **Expected:** No `--gpus` flag in Docker args

### 4. Environment Variable Forwarding

1. Call `runEval({ command: 'python train.py', timeoutSecs: 300, cwd: '/project', env: { CUDA_VISIBLE_DEVICES: '0,1', WANDB_API_KEY: 'secret' } })`
2. **Expected:** Docker args include `-e CUDA_VISIBLE_DEVICES=0,1` and `-e WANDB_API_KEY=secret`
3. Call with no `env` field
4. **Expected:** No `-e` flags in Docker args

### 5. Exit Code 124 — Timeout

1. Configure mock docker to exit with code 124
2. Call `runEval(...)` 
3. **Expected:** Result has `timedOut: true`, `exitCode: 124`, and stderr contains timeout-related output

### 6. Exit Code 125 — Docker Daemon Error

1. Configure mock docker to exit with code 125 and stderr "Cannot connect to the Docker daemon"
2. Call `runEval(...)`
3. **Expected:** Result has `exitCode: 125`, `timedOut: false`, stderr preserves "Cannot connect to the Docker daemon"
4. Repeat with empty stderr from docker
5. **Expected:** stderr contains fallback message "Docker daemon error (exit 125)"

### 7. Exit Codes 126/127 — Command Errors

1. Configure mock docker to exit with code 126
2. **Expected:** Result has `exitCode: 126`, stderr has command-not-invokable message or native stderr
3. Configure mock docker to exit with code 127
4. **Expected:** Result has `exitCode: 127`, stderr has command-not-found message or native stderr

### 8. Extra Volume Mounts

1. Create config with `volumes: ['/data:/data:ro', '/models:/models']`
2. Call `runEval(...)` on local path
3. **Expected:** Docker args include `-v /data:/data:ro` and `-v /models:/models` in addition to the workspace mount

### 9. Factory Routing

1. Call `resolveBackend({ type: 'docker', image: 'node:20' })`
2. **Expected:** Returns a `DockerBackend` instance with a `runEval` method
3. Call `resolveBackend({ type: 'local' })` and `resolveBackend(undefined)`
4. **Expected:** Both return `LocalBackend` — no regression

### 10. No Regression on Existing Backends

1. Run `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts`
2. **Expected:** 45 passed, 0 failed — all LocalBackend and factory tests unchanged

## Edge Cases

### Missing repoUrl with dockerHost

1. Create config with `dockerHost: 'tcp://remote:2376'` but no `repoUrl`
2. Call `runEval(...)`
3. **Expected:** Returns structured error result (not an exception) with stderr containing actionable message about missing `repoUrl`. `exitCode: 1`, `timedOut: false`.

### Safety-Net Timeout (spawnSync Kill)

1. Set `timeoutSecs` to a very short value where the safety-net (+60s) fires before Docker returns
2. **Expected:** Result has `timedOut: true`, signal field populated (e.g., `SIGTERM`), stderr reflects the kill

### Normal Failure Forwarding

1. Configure mock docker to exit with code 1 (normal failure)
2. **Expected:** Result has `exitCode: 1`, `timedOut: false`, stdout/stderr forwarded as-is — no Docker-specific exit code mapping applied

### RunEvalResult Shape Consistency

1. For success, failure, and timeout outcomes, verify the result object has exactly 5 fields: `stdout`, `stderr`, `exitCode`, `timedOut`, `durationMs`
2. **Expected:** All fields present with correct types (string, string, number, boolean, number) for all outcome paths

## Failure Signals

- Any test printing `FAIL:` in the docker-backend test output
- Exit code != 0 from either test suite
- New TypeScript errors in `npm run build` (beyond the pre-existing code-sync.ts error)
- `resolveBackend({ type: 'docker', ... })` throwing instead of returning DockerBackend
- Docker exit codes (125/126/127) not producing structured stderr messages

## Requirements Proved By This UAT

- R029 (Docker Compute Backend) — contract tests prove local/remote paths, GPU passthrough, exit code mapping, env forwarding, volume mounts, and daemon error handling
- R034 (Backend Failure Handling) — Docker daemon errors, command errors, missing config, and safety-net timeouts all produce structured results, not crashes
- R035 (Eval Timeout Forwarding) — timeout wrapper inside container, exit 124 mapping, safety-net spawnSync kill

## Not Proven By This UAT

- Real Docker daemon interaction (container pull, actual container lifecycle) — requires Docker installation
- Docker GPU passthrough with real nvidia-container-toolkit — requires GPU hardware
- Remote Docker host over network — requires remote Docker daemon
- End-to-end eval pipeline dispatch with Docker backend — deferred to S05 integration test

## Notes for Tester

- All tests use a mock docker shell script, not a real Docker installation. The mock captures invocation args to a temp file and returns pre-configured exit codes/stdout/stderr.
- The pre-existing TS error in `code-sync.ts` (import path ending in `.ts`) is from S02 and unrelated to S04 changes.
- Remote path tests create a local bare git repo as the "remote" — real `pushExperimentBranch()` and `runGit()` calls run against local git, only the Docker binary spawn is mocked.
