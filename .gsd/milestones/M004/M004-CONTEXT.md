# M004: Remote Compute Backends — Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

## Project Description

Labrat's eval pipeline currently runs eval commands as local subprocesses via `spawnSync()`. This milestone adds a pluggable compute backend abstraction so eval execution can be dispatched to remote machines (SSH), containers (Docker), or future serverless GPU platforms (Modal, RunPod, Lambda) — while the LLM orchestration, git state, .gsd files, and keep/discard logic all remain local.

## Why This Milestone

ML research eval typically needs GPU hardware that isn't the developer's laptop. The orchestrator (LLM + state machine) runs fine anywhere, but `python train.py` needs to run where the GPU lives. Today Labrat can only eval locally, which means users must run the entire agent on the GPU box. This milestone decouples orchestration from compute so users can develop locally and dispatch training to remote resources.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Add `"compute": { "type": "ssh", "host": "user@gpu-box", "workDir": "/path/to/project" }` to their CAMPAIGN.json and have eval commands execute on that remote machine via SSH
- Add `"compute": { "type": "docker", "image": "pytorch/pytorch:latest" }` to their CAMPAIGN.json and have eval commands execute inside a Docker container with optional GPU passthrough
- Omit the `compute` field entirely and get identical behavior to today (local subprocess)
- See clear error messages when remote backends fail ("SSH connection refused", "Docker image not found") instead of crashes

### Entry point / environment

- Entry point: `labrat start` / `labrat auto` CLI commands (unchanged)
- Environment: local dev machine orchestrating, remote compute for eval
- Live dependencies involved: SSH daemon on remote hosts, Docker daemon (local or remote), git remote for code sync

## Completion Class

- Contract complete means: all backend implementations pass contract tests proving exec/timeout/error handling, eval pipeline dispatch tests prove correct routing
- Integration complete means: SSH backend proven with a real SSH connection (or faithful mock), Docker backend proven with real Docker daemon interaction (or faithful mock)
- Operational complete means: a campaign can run with remote eval, survive backend transient failures, and produce identical morning reports as local eval

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A campaign with `compute.type: 'ssh'` pushes code via git, executes eval over SSH, and returns metrics that feed into keep/discard decisions
- A campaign with `compute.type: 'docker'` runs eval inside a container and returns identical `RunEvalResult` shape
- A campaign with no `compute` field works exactly as before (backward compatibility)
- Backend connection failures produce discard decisions with clear error messages, not crashes

## Risks and Unknowns

- **SSH connection reliability** — long-running eval commands over SSH can be interrupted by network issues. ControlMaster multiplexing mitigates connection overhead but doesn't solve mid-eval drops.
- **Docker GPU passthrough** — `--gpus all` requires nvidia-container-toolkit on the host. If not present, must fail with actionable error, not cryptic Docker error.
- **Git push latency** — pushing to origin before every eval adds overhead per experiment. Must be fast for small diffs.
- **Remote environment differences** — eval command may depend on env vars, PATH, conda envs that differ between local and remote. Must document that remote env is user's responsibility.

## Existing Codebase / Prior Art

- `src/resources/extensions/gsd/eval-runner.ts` — `runEval()` function at line 41 is the exact insertion point. Uses `spawnSync()` with shell, timeout, cwd. Returns `RunEvalResult` with stdout/stderr/exitCode/signal/timedOut.
- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess()` at line 518 calls `runEval()`. This is the orchestrator that must stay local.
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` interface at line 280 where `compute` field will be added.
- `src/resources/extensions/gsd/types.ts` — `EvaluationConfig` interface with `command`, `timeout`, `runs` fields.
- `packages/pi-coding-agent/src/core/tools/bash.ts` — `BashOperations` interface is a prior art pattern for pluggable command execution. Similar design philosophy.
- `src/resources/extensions/gsd/git-service.ts` — `GitServiceImpl` with push support (`auto_push`, `remote` preference). Git operations live here.
- `src/resources/extensions/gsd/worktree.ts` — `ensureSliceBranch()`, `commitExperiment()`, `getCurrentBranch()` — git state management.
- `src/resources/extensions/gsd/mlops-integration.ts` — prior art for optional integration wired into campaign lifecycle (pattern: create client if config present, non-fatal hooks).

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R027 — Compute Backend Interface: the core abstraction this milestone delivers
- R028 — SSH Backend: first shipped remote backend
- R029 — Docker Backend: second shipped remote backend, containerized reproducibility
- R030 — Eval Pipeline Integration: wiring the abstraction into the existing pipeline
- R031 — Backend Configuration: CampaignConfig.compute field
- R032 — Code Sync via Git: push/pull mechanism for getting code to remote
- R033 — Credential Management: reuse OS mechanisms, no custom credential store
- R034 — Backend Failure Handling: graceful degradation on remote errors
- R035 — Eval Timeout Forwarding: same timeout semantics regardless of backend

## Scope

### In Scope

- ComputeBackend interface + LocalBackend (wraps existing spawnSync)
- SSH backend using native `ssh` binary
- Docker backend using native `docker` CLI
- Git push before remote eval for code sync
- CampaignConfig.compute configuration field
- Backend error → graceful discard decision
- Timeout forwarding to remote backends
- Contract tests for each backend

### Out of Scope / Non-Goals

- Auto-provisioning remote infrastructure (R040)
- Multi-backend parallel eval (R041)
- Modal, RunPod, Lambda, Kubernetes backends (R036–R039, deferred)
- Modifying what the LLM sees or does — experiment prompts unchanged
- Remote .gsd file management — all state stays local
- Remote MLOps connectivity setup — user configures remote env

## Technical Constraints

- Must use native `ssh` and `docker` CLI binaries — no Node.js SSH/Docker client libraries. Keeps dependency footprint zero and leverages user's existing SSH config/keys.
- `RunEvalResult` interface must not change — backends return the same shape.
- Backend dispatch must be synchronous from the caller's perspective (like `spawnSync` today) — the eval pipeline is synchronous.
- Git push must not force-push — normal push only. If push fails (diverged remote), surface as error.

## Integration Points

- **Git remote (origin)** — push experiment branch before remote eval, remote pulls it
- **SSH daemon** — connection to remote hosts, must respect `~/.ssh/config` and ssh-agent
- **Docker daemon** — local or remote via `-H` flag, must support `--gpus` for GPU passthrough
- **eval-runner.ts** — `runEval()` dispatches to backend; `runExperimentPostProcess()` unchanged
- **CampaignConfig** — new `compute` field parsed alongside existing `mlops` and `agenda`

## Open Questions

- **SSH ControlMaster lifecycle** — should the control socket persist across experiments (faster) or be per-eval (safer)? Leaning toward persist-per-campaign with cleanup on campaign end.
- **Docker volume mount vs git clone** — for local Docker, mounting the repo as a volume is simpler and faster than git clone inside the container. For remote Docker (`-H`), volume mount may not work. Likely support both patterns based on config.
