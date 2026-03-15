# S04: Docker Compute Backend — Research

**Date:** 2026-03-15

## Summary

DockerBackend follows the same pattern as SSHBackend: a class implementing `ComputeBackend.runEval()` that shells out to a native CLI binary (`docker` instead of `ssh`) via `spawnSync`. The Docker-specific concerns are: container lifecycle management (`docker run --rm`), volume mounting for local Docker, git clone for remote Docker (`-H`), GPU passthrough (`--gpus`), and Docker-specific exit code mapping (125 = daemon error, 126 = command not invokable, 127 = command not found, 124 = timeout inside container).

The primary design decision is **volume mount vs git clone**. For local Docker (no `dockerHost`), volume-mounting the repo at `/workspace` is simpler, faster, and requires no git push. For remote Docker (`-H` flag pointing at a remote daemon), volume mount doesn't work because the filesystem isn't shared — the container must git clone the repo, which requires `pushExperimentBranch()` first and a `repoUrl` in the config. Both paths converge on the same `timeout <secs> <command>` pattern inside the container.

Docker is not installed in the CI/test environment. Unlike SSH (where S03 used real localhost SSH), Docker tests must use mock scripts that simulate `docker` CLI behavior. This is fine — the contract being tested is the argument assembly, exit code mapping, and error handling, not Docker internals.

## Recommendation

Follow the SSHBackend pattern closely:

1. **`docker-backend.ts`** — `DockerBackend` class implementing `ComputeBackend.runEval()`:
   - Local path (no `dockerHost`): `docker run --rm -w /workspace -v <cwd>:/workspace [--gpus <g>] [extra volumes] [-e K=V] <image> sh -c 'timeout <secs> <command>'`
   - Remote path (`dockerHost` set): `pushExperimentBranch()` first, then `docker -H <host> run --rm [--gpus <g>] [-e K=V] <image> sh -c 'git clone <repoUrl> /workspace && cd /workspace && git checkout <ref> && timeout <secs> <command>'`
   - `mapDockerResult()` — exit code mapper like `mapSSHResult()`

2. **`types.ts`** — Extend `ComputeConfig` union with `{ type: 'docker'; image: string; gpus?: string; dockerHost?: string; volumes?: string[]; repoUrl?: string }`

3. **`compute-backend.ts`** — Add `case 'docker'` to `resolveBackend()`

4. **Tests** — Mock `docker` binary via `PATH` manipulation. Create a shell script that simulates Docker behavior (echoes args, returns configured exit codes). Test all paths: success, failure, timeout (exit 124), daemon error (exit 125), GPU flag inclusion, env forwarding, volume mount args, remote path with git clone, and factory routing.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Shell-safe value quoting | `shellQuote()` in ssh-backend.ts | Same single-quote wrapping needed for env values and paths in docker commands — duplicate the 3-line helper rather than extracting a shared module |
| Exit code mapping pattern | `mapSSHResult()` in ssh-backend.ts | Same structural pattern (switch on exit code / signal / error code → RunEvalResult). Adapt for Docker-specific codes. |
| Code sync for remote backends | `pushExperimentBranch()` in code-sync.ts | Already proven by S02 — reuse directly for remote Docker path |
| Test repo setup | `setupRepoWithBareRemote()` in ssh-backend.test.ts | Same pattern needed for remote Docker tests that exercise git clone path |

## Existing Code and Patterns

- `src/resources/extensions/gsd/ssh-backend.ts` — Direct template. Same flow: sync code → build command → spawnSync → map result. Docker differs in: no ControlMaster, `docker run` instead of `ssh`, volume mount instead of `cd workDir && git fetch`, env via `-e` flag instead of `export` prefix.
- `src/resources/extensions/gsd/compute-backend.ts` — Interface and factory. Add import + case for DockerBackend. Exhaustiveness guard will force the case.
- `src/resources/extensions/gsd/types.ts` lines 305-307 — `ComputeConfig` union. Add Docker variant to the union.
- `src/resources/extensions/gsd/code-sync.ts` — `pushExperimentBranch()` for remote Docker path.
- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — Test structure template: assert/assertEq helpers, setupRepoWithBareRemote, cleanup, test groups by scenario.
- `src/resources/extensions/gsd/eval-runner.ts` line 555 — `resolveBackend(config.compute)` call site. No changes needed — factory handles routing.

## Constraints

- **Native `docker` CLI only** (D064) — no Node.js Docker client libraries. Uses `spawnSync('docker', args)`.
- **Synchronous blocking** — `docker run` blocks until container exits. Same as local `spawnSync` and SSH `spawnSync`. No async.
- **RunEvalResult shape must not change** — Docker backend returns the exact same 5-field struct.
- **No Docker in test environment** — must mock the `docker` binary for testing. Create a shell script mock, prepend to PATH.
- **Volume mount only works for local Docker** — when `dockerHost` is set, the local filesystem isn't accessible to the remote daemon. Must use git clone inside the container.
- **`--gpus` requires nvidia-container-toolkit** — absence produces Docker exit 125 with an error message. Must not swallow this error.

## Common Pitfalls

- **Forgetting `--rm` flag** — leaked containers accumulate. Always use `--rm` so the container is removed after exit.
- **Safety-net timeout too tight** — Docker has startup overhead (image pull, container init). Safety-net must account for this. Use `(timeoutSecs + 60) * 1000` instead of SSH's `+30s` to absorb container startup time.
- **Volume mount path escaping on macOS** — paths with spaces need quoting. Use `-v` with proper escaping.
- **Exit code 125 vs container exit code** — Docker returns 125 for its own errors (daemon not running, image not found, bad `--gpus`). Container exit codes pass through directly. Exit 124 from `timeout` inside the container is the timeout signal. Must distinguish these clearly in `mapDockerResult()`.
- **Env vars with special characters** — Docker's `-e KEY=VALUE` handles most cases, but values with spaces or quotes need care. Use `-e` flag per variable (not `--env-file`) for simplicity.
- **Mock docker script must handle all subcommands** — tests need to simulate `docker run` specifically. The mock should check `$1 == "run"` and handle args accordingly.

## Open Risks

- **Docker image pull time** — First run with a new image triggers a pull that can take minutes. This is within the safety-net timeout but could surprise users. Not something we can fix — document it.
- **Volume mount permission issues** — Container user may not match host user. Files created in the container may have wrong ownership. Not in scope to fix — user's responsibility to configure the image appropriately.
- **Remote Docker (`-H`) with TLS** — Docker's `-H` flag supports `tcp://host:2376` with TLS. If TLS certs are misconfigured, Docker produces exit 125. We surface the error but can't diagnose TLS config.
- **`repoUrl` for remote Docker** — The config needs a `repoUrl` field for git clone inside the container. If the user configures `dockerHost` but omits `repoUrl`, we must produce an actionable error. Config validation is S05's job, but the backend should fail gracefully.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Docker CLI | sickn33/antigravity-awesome-skills@docker-expert | available — not relevant (focuses on Dockerfile authoring, not programmatic CLI invocation) |

No skills installed — the work is standard `child_process.spawnSync` with Docker CLI arguments, not Docker-specific framework usage.

## Sources

- SSHBackend implementation (source: `src/resources/extensions/gsd/ssh-backend.ts`) — primary design template
- S03 Forward Intelligence (source: `.gsd/milestones/M004/slices/S03/S03-SUMMARY.md`) — noted `shellQuote()` reuse opportunity and test pattern adaptability
- Docker exit code conventions (source: training data) — 125 daemon error, 126 command not invokable, 127 command not found
- M004 Context open questions (source: `.gsd/milestones/M004/M004-CONTEXT.md`) — volume mount vs git clone decision
