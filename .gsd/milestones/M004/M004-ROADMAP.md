# M004: Remote Compute Backends

**Vision:** Decouple eval execution from the local machine. The LLM orchestrates experiments locally; the eval command dispatches to pluggable compute backends — SSH boxes, Docker containers, or future serverless GPU platforms. Users develop locally, train remotely.

## Success Criteria

- A campaign with `compute: { type: 'ssh' }` runs eval on a remote machine via SSH and produces correct keep/discard decisions
- A campaign with `compute: { type: 'docker' }` runs eval inside a Docker container and produces correct keep/discard decisions
- A campaign with no `compute` field works identically to today (backward compatibility proven by existing tests passing unchanged)
- Backend failures produce clean discard decisions with actionable error messages, not crashes
- The `ComputeBackend` interface is extensible — a new backend can be added by implementing one interface without modifying the eval pipeline

## Key Risks / Unknowns

- **SSH reliability for long-running eval** — network interruptions mid-eval could produce partial stdout and ambiguous exit codes
- **Docker GPU passthrough** — `--gpus` flag requires nvidia-container-toolkit; absence must produce clear error
- **Git push overhead** — pushing before every eval adds latency; must be fast for incremental diffs
- **Synchronous blocking** — `runEval()` is synchronous (`spawnSync`); remote backends must also block until complete

## Proof Strategy

- SSH reliability → retire in S03 by proving eval survives connection setup, command execution, timeout kill, and connection error — all via contract tests with native ssh subprocess
- Docker GPU passthrough → retire in S04 by proving `--gpus` flag is included when configured, container lifecycle is clean, and missing Docker daemon produces actionable error
- Git push overhead → retire in S02 by proving incremental push is fast (<2s for small diffs) and idempotent (no-op when up to date)
- Synchronous blocking → retire in S01 by proving `ComputeBackend.runEval()` blocks and returns `RunEvalResult` for all backend types

## Verification Classes

- Contract verification: unit tests for each backend (mocked subprocess for SSH/Docker), interface contract tests, config parsing tests
- Integration verification: eval pipeline dispatch with configured backends returning expected results
- Operational verification: backend failure scenarios (connection refused, timeout, Docker not running) produce graceful discard
- UAT / human verification: user runs campaign with SSH backend against real remote host

## Milestone Definition of Done

This milestone is complete only when all are true:

- All existing eval pipeline tests pass unchanged (backward compatibility)
- ComputeBackend interface exists with LocalBackend, SSHBackend, DockerBackend implementations
- SSH backend proven by contract tests: connect, sync code, exec, stream output, timeout, error handling
- Docker backend proven by contract tests: container lifecycle, exec, GPU flag, timeout, error handling
- Git code sync pushes experiment branch before remote eval, verified by tests
- CampaignConfig.compute field parsed correctly; absent = local
- Backend errors → graceful discard with error message in experiment log
- Final integration test: eval pipeline dispatches to correct backend based on config

## Requirement Coverage

- Covers: R027, R028, R029, R030, R031, R032, R033, R034, R035
- Partially covers: none
- Leaves for later: R036 (Modal), R037 (RunPod), R038 (Lambda), R039 (Kubernetes)
- Orphan risks: none

## Slices

- [x] **S01: Compute Backend Interface & Local Backend** `risk:high` `depends:[]`
  > After this: `runEval()` dispatches through `ComputeBackend` interface; existing local eval works identically via `LocalBackend`; all existing tests pass unchanged (proven by test suite).

- [x] **S02: Git Code Sync** `risk:medium` `depends:[S01]`
  > After this: before remote eval, experiment branch is pushed to origin; `syncCode()` helper verifies the push succeeded and the remote ref matches local HEAD (proven by contract tests with git subprocess).

- [x] **S03: SSH Compute Backend** `risk:high` `depends:[S01,S02]`
  > After this: `SSHBackend` connects to a remote host via native ssh, pulls experiment branch, runs eval command, returns stdout/stderr/exit code/timing; timeout kills remote process; connection errors produce discard (proven by contract tests).

- [ ] **S04: Docker Compute Backend** `risk:medium` `depends:[S01,S02]`
  > After this: `DockerBackend` runs eval inside a Docker container with optional GPU passthrough, returns same `RunEvalResult` shape; missing Docker daemon produces actionable error (proven by contract tests).

- [ ] **S05: Configuration, Credentials & Integration** `risk:low` `depends:[S01,S02,S03,S04]`
  > After this: `CampaignConfig.compute` field fully parsed with backend-specific validation; credential errors produce actionable messages; end-to-end dispatch test proves config → backend resolution → eval execution → result return.

## Boundary Map

### S01 → S02, S03, S04, S05

Produces:
- `compute-backend.ts` → `ComputeBackend` interface with `runEval(opts: ComputeEvalOpts): RunEvalResult`
- `compute-backend.ts` → `ComputeEvalOpts` type: `{ command: string, timeoutSecs: number, cwd: string, env?: Record<string, string> }`
- `compute-backend.ts` → `LocalBackend` class implementing `ComputeBackend` (wraps existing `spawnSync` logic)
- `compute-backend.ts` → `resolveBackend(config?: ComputeConfig): ComputeBackend` factory function
- `eval-runner.ts` → `runEval()` refactored to accept optional `ComputeBackend` parameter, defaults to `LocalBackend`
- `types.ts` → `ComputeConfig` discriminated union type on `CampaignConfig`

Consumes: nothing (first slice)

### S02 → S03, S04

Produces:
- `code-sync.ts` → `pushExperimentBranch(basePath: string, remote?: string): SyncResult`
- `code-sync.ts` → `SyncResult` type: `{ pushed: boolean, ref: string, remote: string, error?: string }`

Consumes from S01:
- `ComputeBackend` interface (to know when sync is needed — remote backends only)

### S03 → S05

Produces:
- `ssh-backend.ts` → `SSHBackend` class implementing `ComputeBackend`
- `ssh-backend.ts` → `SSHBackendConfig` type: `{ host: string, workDir: string, controlPath?: string }`

Consumes from S01:
- `ComputeBackend` interface, `ComputeEvalOpts`, `RunEvalResult`

Consumes from S02:
- `pushExperimentBranch()` — called before SSH eval to ensure remote has latest code

### S04 → S05

Produces:
- `docker-backend.ts` → `DockerBackend` class implementing `ComputeBackend`
- `docker-backend.ts` → `DockerBackendConfig` type: `{ image: string, gpus?: string, dockerHost?: string, volumes?: string[] }`

Consumes from S01:
- `ComputeBackend` interface, `ComputeEvalOpts`, `RunEvalResult`

Consumes from S02:
- `pushExperimentBranch()` — called before Docker eval if using git clone (not volume mount)

### S05 → (terminal)

Produces:
- Updated `CampaignConfig` parsing with `compute` field validation
- `resolveBackend()` wired to all three backends based on config discriminant
- Credential validation helpers (SSH key check, Docker daemon check)
- End-to-end integration test proving config → backend → eval → result pipeline

Consumes from S01:
- `ComputeBackend` interface, `resolveBackend()`, `LocalBackend`

Consumes from S03:
- `SSHBackend`, `SSHBackendConfig`

Consumes from S04:
- `DockerBackend`, `DockerBackendConfig`
