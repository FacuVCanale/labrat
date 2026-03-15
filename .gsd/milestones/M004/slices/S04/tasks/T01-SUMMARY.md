---
id: T01
parent: S04
milestone: M004
provides:
  - DockerBackend class with local (volume mount) and remote (git clone) code paths
  - Docker variant in ComputeConfig union type
  - Factory routing for type 'docker' in resolveBackend()
key_files:
  - src/resources/extensions/gsd/docker-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/compute-backend.ts
key_decisions:
  - Duplicated shellQuote() locally in docker-backend.ts rather than extracting shared module (per research — matches ssh-backend.ts pattern)
  - Safety-net timeout set to +60s (vs SSH's +30s) to account for Docker image pull and container startup overhead
  - Remote path gets both branch name and HEAD ref — uses ref for git checkout (deterministic) rather than branch name (could advance)
patterns_established:
  - DockerBackend follows same constructor(config) → runEval(opts) → mapResult() pattern as SSHBackend
  - Local Docker path: volume mount cwd at /workspace, no git push required
  - Remote Docker path: pushExperimentBranch() → get ref → docker -H host run with git clone inside container
  - Docker-specific exit codes (125/126/127) mapped to structured stderr messages with fallback defaults
observability_surfaces:
  - grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts — all exit code mapping sites
  - RunEvalResult.stderr contains Docker-specific diagnostics for daemon errors (125), invocation errors (126/127), and push failures
  - Push errors prefixed with "Code sync failed:", missing repoUrl returns actionable error message
duration: 12m
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T01: Implement DockerBackend with local and remote paths

**Created DockerBackend class with two code paths (local volume mount, remote git clone), extended ComputeConfig union, and wired into resolveBackend() factory.**

## What Happened

Implemented `DockerBackend` following the same pattern as `SSHBackend`:

- **Local path** (no `dockerHost`): `docker run --rm -w /workspace -v <cwd>:/workspace [--gpus] [-e K=V] [extra -v] <image> sh -c 'timeout <secs> <command>'`
- **Remote path** (`dockerHost` set): calls `pushExperimentBranch()`, gets HEAD ref, then `docker -H <host> run --rm [--gpus] [-e K=V] <image> sh -c 'git clone <repoUrl> /workspace && cd /workspace && git checkout <ref> && timeout <secs> <command>'`
- Missing `repoUrl` with `dockerHost` returns structured error (no throw)
- `mapDockerResult()` handles exit codes 124 (timeout), 125 (daemon error), 126 (not invokable), 127 (not found), ETIMEDOUT, and SIGTERM/SIGKILL signals
- Extended `ComputeConfig` union with `{ type: 'docker'; image: string; gpus?: string; dockerHost?: string; volumes?: string[]; repoUrl?: string }`
- Added `case 'docker'` to `resolveBackend()` factory with exhaustiveness guard still intact

## Verification

- `npm run build` — compiles clean (1 pre-existing error in code-sync.ts, 0 new errors from Docker additions)
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** (no regression)
- Factory routing verified: `resolveBackend({ type: 'docker', image: 'node:20' })` returns DockerBackend instance
- All must-have items confirmed via grep/inspection

### Slice-level verification status (T01 of 2):
- ❌ `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — test file not yet created (T02 scope)
- ✅ `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 passed, 0 failed
- ✅ `npm run build` — no new type errors

## Diagnostics

- `grep -n 'exit.*124\|exit.*125\|exit.*126\|exit.*127\|ETIMEDOUT' docker-backend.ts` shows all exit code mapping sites
- Push errors: search for `"Code sync failed:"` in stderr
- Missing repoUrl: search for `"repoUrl"` in stderr output
- Docker daemon errors: exit 125 with native stderr or fallback message

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/docker-backend.ts` — new: DockerBackend class, mapDockerResult(), shellQuote()
- `src/resources/extensions/gsd/types.ts` — modified: added Docker variant to ComputeConfig union
- `src/resources/extensions/gsd/compute-backend.ts` — modified: import DockerBackend + case 'docker' in resolveBackend()
