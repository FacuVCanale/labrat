---
id: S04
parent: M004
milestone: M004
provides:
  - DockerBackend class with local (volume mount) and remote (git clone) code paths
  - Docker exit code mapping (124/125/126/127/ETIMEDOUT/signal)
  - Docker variant in ComputeConfig union type
  - Factory routing for type 'docker' in resolveBackend()
  - 79-assertion contract test suite with mock docker binary
requires:
  - slice: S01
    provides: ComputeBackend interface, ComputeEvalOpts, RunEvalResult, resolveBackend()
  - slice: S02
    provides: pushExperimentBranch() for remote Docker path
affects:
  - S05
key_files:
  - src/resources/extensions/gsd/docker-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/tests/docker-backend.test.ts
key_decisions:
  - Duplicated shellQuote() locally in docker-backend.ts rather than extracting shared module (matches ssh-backend.ts pattern)
  - Safety-net timeout set to +60s (vs SSH's +30s) to account for Docker image pull and container startup overhead
  - Remote path uses HEAD ref for git checkout (deterministic) rather than branch name (could advance between push and checkout)
  - Mock docker as shell script on PATH — tests the real spawnSync call path rather than module-level mocking
patterns_established:
  - DockerBackend follows same constructor(config) → runEval(opts) → mapResult() pattern as SSHBackend
  - Local Docker: volume mount cwd at /workspace, no git push required
  - Remote Docker: pushExperimentBranch() → get ref → docker -H host run with git clone inside container
  - Docker-specific exit codes (125/126/127) mapped to structured stderr messages with fallback defaults
observability_surfaces:
  - grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts — all exit code mapping sites
  - RunEvalResult.stderr contains Docker-specific diagnostics for daemon errors (125), invocation errors (126/127), and push failures
  - Push errors prefixed with "Code sync failed:", missing repoUrl returns actionable error message
drill_down_paths:
  - .gsd/milestones/M004/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S04/tasks/T02-SUMMARY.md
duration: 2 tasks
verification_result: passed
completed_at: 2026-03-15
---

# S04: Docker Compute Backend

**DockerBackend runs eval inside Docker containers with local volume-mount and remote git-clone paths, optional GPU passthrough, and structured exit code mapping — proven by 79-assertion contract test suite.**

## What Happened

Implemented `DockerBackend` following the same `constructor(config) → runEval(opts) → mapResult()` pattern established by `SSHBackend` in S03.

**Local path** (no `dockerHost`): volume-mounts cwd at `/workspace`, runs `docker run --rm -w /workspace -v <cwd>:/workspace [--gpus] [-e K=V] [extra -v] <image> sh -c 'timeout <secs> <command>'`. No git push needed — code is already on the local filesystem.

**Remote path** (`dockerHost` set): calls `pushExperimentBranch()` to sync code, captures HEAD ref, then runs `docker -H <host> run --rm [--gpus] [-e K=V] <image> sh -c 'git clone <repoUrl> /workspace && cd /workspace && git checkout <ref> && timeout <secs> <command>'`. Missing `repoUrl` with `dockerHost` returns a structured error without throwing.

Exit code mapping handles Docker-specific semantics: 124 (timeout), 125 (daemon error), 126 (command not invokable), 127 (command not found), plus ETIMEDOUT and signal-based safety-net kills. Each exit code produces structured stderr with fallback messages when Docker's native stderr is empty.

Extended `ComputeConfig` discriminated union with Docker variant and added `case 'docker'` to `resolveBackend()` factory.

Contract tests use a mock docker shell script prepended to `PATH` — captures all invocation args to a file and returns configurable exit codes/stdout/stderr. Tests verify argument assembly, exit code mapping, env forwarding, GPU flag presence/absence, volume mounts, both code paths, error handling, result shape, and factory routing.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — **79 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** (no regression) ✓
- `npm run build` — compiles clean (1 pre-existing TS error in code-sync.ts, 0 new errors from Docker additions) ✓
- Observability: `grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts` confirms all exit code mapping sites ✓

## Requirements Advanced

- R029 (Docker Compute Backend) — DockerBackend fully implemented with local and remote paths, GPU passthrough, exit code mapping, and contract test suite
- R034 (Backend Failure Handling) — Docker daemon errors (exit 125), command errors (126/127), missing repoUrl, and safety-net timeout all produce structured discard-worthy results, not exceptions
- R035 (Eval Timeout Forwarding) — Timeout forwarded via `timeout` wrapper inside container, Docker-specific exit 124 mapping, safety-net spawnSync timeout with +60s buffer

## Requirements Validated

- R029 — 79 contract tests prove: successful eval (local and remote), failure forwarding, timeout (exit 124), daemon error (exit 125), command errors (126/127), GPU flag inclusion/omission, env forwarding, volume mounts, missing repoUrl error, safety-net timeout, result shape for all outcome types, and factory routing

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None. Implementation followed the plan exactly.

## Known Limitations

- Safety-net timeout is hardcoded at `timeoutSecs + 60` — may need tuning if Docker image pulls are very slow on first use
- `shellQuote()` duplicated in both ssh-backend.ts and docker-backend.ts — intentional per research, avoids shared module extraction for two consumers

## Follow-ups

- S05 will wire `DockerBackendConfig` into full `CampaignConfig` parsing with validation
- S05 will add Docker daemon reachability check as credential/pre-flight validation

## Files Created/Modified

- `src/resources/extensions/gsd/docker-backend.ts` — new: DockerBackend class, mapDockerResult(), shellQuote()
- `src/resources/extensions/gsd/types.ts` — modified: added Docker variant to ComputeConfig union
- `src/resources/extensions/gsd/compute-backend.ts` — modified: import DockerBackend + case 'docker' in resolveBackend()
- `src/resources/extensions/gsd/tests/docker-backend.test.ts` — new: 79-assertion contract test suite with mock docker binary

## Forward Intelligence

### What the next slice should know
- `DockerBackendConfig` type is already in types.ts: `{ type: 'docker'; image: string; gpus?: string; dockerHost?: string; volumes?: string[]; repoUrl?: string }`
- `resolveBackend()` already handles `type: 'docker'` — S05 just needs to parse config and validate
- Docker daemon check: `spawnSync('docker', ['info'])` exit code 0 means daemon is reachable

### What's fragile
- Remote Docker path depends on `repoUrl` being a URL the container can reach — if running on a remote Docker host, the repo must be accessible from that host's network, not just the local machine

### Authoritative diagnostics
- `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — 79 assertions covering the full behavior matrix, trustworthy because they test the real spawnSync path with mock binary
- `grep -n 'exit.*124\|exit.*125' docker-backend.ts` — shows all Docker-specific error handling sites

### What assumptions changed
- None — Docker backend followed the predicted pattern from SSH backend closely
