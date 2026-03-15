---
estimated_steps: 5
estimated_files: 3
---

# T01: Implement DockerBackend with local and remote paths

**Slice:** S04 — Docker Compute Backend
**Milestone:** M004

## Description

Create `DockerBackend` class implementing `ComputeBackend.runEval()` via `spawnSync('docker', ...)`. Two code paths: local Docker (volume mount, no git push) and remote Docker (`-H` flag, git clone inside container). Extend `ComputeConfig` union and wire into `resolveBackend()` factory.

## Steps

1. Add Docker variant to `ComputeConfig` union in `types.ts`: `{ type: 'docker'; image: string; gpus?: string; dockerHost?: string; volumes?: string[]; repoUrl?: string }`
2. Create `docker-backend.ts` with `DockerBackend` class:
   - Constructor takes `DockerBackendConfig` (extracted via `Extract<ComputeConfig, { type: 'docker' }>`)
   - `runEval()` checks `dockerHost` to choose local vs remote path
   - **Local path:** `docker run --rm -w /workspace -v <cwd>:/workspace [--gpus] [-e K=V] [extra -v] <image> sh -c 'timeout <secs> <command>'`
   - **Remote path:** call `pushExperimentBranch()`, get current branch + HEAD ref, then `docker -H <host> run --rm [--gpus] [-e K=V] <image> sh -c 'git clone <repoUrl> /workspace && cd /workspace && git checkout <ref> && timeout <secs> <command>'` — fail early with actionable error if `repoUrl` is missing
   - Safety-net spawnSync timeout: `(timeoutSecs + 60) * 1000`
   - Build env args: one `-e KEY=VALUE` per entry in `opts.env`
   - Build volume args: `-v <cwd>:/workspace` for local, plus any `config.volumes`
   - Build GPU args: `--gpus <value>` when `config.gpus` is set
3. Implement `mapDockerResult()` — same pattern as `mapSSHResult()`:
   - spawnSync ETIMEDOUT → timedOut:true (safety-net)
   - signal SIGTERM/SIGKILL → timedOut:true (safety-net)
   - exit 124 → timedOut:true (remote `timeout` command)
   - exit 125 → daemon error (stderr preserved)
   - exit 126 → command not invokable
   - exit 127 → command not found
   - otherwise → forward exit code as-is
4. Add `shellQuote()` helper locally in docker-backend.ts (duplicate from ssh-backend.ts, not shared)
5. Wire into factory: import `DockerBackend` in compute-backend.ts, add `case 'docker'` before exhaustiveness guard

## Must-Haves

- [ ] DockerBackend implements ComputeBackend interface
- [ ] Local path uses volume mount at /workspace, no git push
- [ ] Remote path calls pushExperimentBranch() and uses git clone inside container
- [ ] Missing repoUrl with dockerHost produces structured error, not throw
- [ ] `--gpus` flag included only when configured
- [ ] Env vars forwarded via `-e` flags
- [ ] Extra volumes forwarded via `-v` flags
- [ ] Safety-net timeout is timeoutSecs + 60s (Docker startup overhead)
- [ ] mapDockerResult handles exit codes 124, 125, 126, 127, ETIMEDOUT, signals
- [ ] resolveBackend() routes type 'docker' to DockerBackend
- [ ] Existing compute-backend tests pass unchanged

## Verification

- `npm run build` — no new type errors
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 passed, 0 failed

## Observability Impact

- Signals added/changed: `RunEvalResult.stderr` populated with Docker-specific error messages for exit 125/126/127 and push failures
- How a future agent inspects this: `grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts`
- Failure state exposed: Push errors prefixed `"Code sync failed:"`, missing repoUrl returns structured error in stderr

## Inputs

- `src/resources/extensions/gsd/ssh-backend.ts` — primary design template (same flow pattern)
- `src/resources/extensions/gsd/compute-backend.ts` — interface and factory to extend
- `src/resources/extensions/gsd/types.ts` — ComputeConfig union to extend
- `src/resources/extensions/gsd/code-sync.ts` — pushExperimentBranch() for remote path

## Expected Output

- `src/resources/extensions/gsd/docker-backend.ts` — new: DockerBackend class, mapDockerResult(), shellQuote()
- `src/resources/extensions/gsd/types.ts` — modified: ComputeConfig union with Docker variant
- `src/resources/extensions/gsd/compute-backend.ts` — modified: import + case for DockerBackend
