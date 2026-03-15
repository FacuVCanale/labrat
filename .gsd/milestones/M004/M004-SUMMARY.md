---
id: M004
provides:
  - ComputeBackend interface with LocalBackend, SSHBackend, DockerBackend implementations
  - resolveBackend() factory with exhaustive type discrimination
  - pushExperimentBranch() git code sync with post-push verification
  - validateComputeConfig() at parse time in parseCampaignConfig
  - checkSSHConnectivity() and checkDockerDaemon() pre-flight helpers
  - Backend error wrapping in eval-runner producing clean discard results
  - CampaignConfig.compute optional field (absent = local, SSH, Docker variants)
key_decisions:
  - "D062: Only eval dispatches to remote — orchestration/git/state stay local"
  - "D063: Git push/pull for all remote backends, no rsync/scp"
  - "D064: Native ssh/docker CLI binaries via child_process, zero new dependencies"
  - "D066: Backend failure → discard decision, not unhandled exception"
  - "D067: LocalBackend replicates spawnSync internally, does not delegate to runEval()"
  - "D073: Compute config validation at parse time, invalid = null"
  - "D074: Backend error wrapping in eval-runner, not auto.ts"
  - "D075: Pre-flight checks non-blocking, never throw"
patterns_established:
  - "ComputeBackend interface — synchronous runEval(opts) → RunEvalResult, same shape for all backends"
  - "resolveBackend factory — config → backend with exhaustive type guard (compile error for unhandled variants)"
  - "Exit code mapping — SSH (124/255/ETIMEDOUT), Docker (124/125/126/127/ETIMEDOUT) with structured stderr"
  - "Pre-flight check pattern — spawnSync with {ok, error?} return, called before compute-intensive work"
  - "Mock binary on PATH — shell scripts capture args for contract testing real spawnSync call paths"
  - "SyncResult struct — {pushed, ref, remote, error?} callers inspect fields, never catch exceptions"
observability_surfaces:
  - "resolveBackend() throws 'Unsupported compute backend type' for unknown types"
  - "Discard reasons prefixed 'Pre-flight failed:' or 'backend error:' for grep-discoverable diagnostics"
  - "SyncResult.error contains git stderr on push failure"
  - "RunEvalResult.stderr contains SSH/Docker diagnostic output on connection/daemon failure"
  - "grep -n 'validateComputeConfig\\|checkSSH\\|checkDocker\\|backend error' state.ts eval-runner.ts compute-backend.ts"
requirement_outcomes:
  - id: R027
    from_status: active
    to_status: validated
    proof: "ComputeBackend interface with LocalBackend, resolveBackend() factory, 45 contract tests (S01)"
  - id: R028
    from_status: active
    to_status: validated
    proof: "SSHBackend via native ssh with ControlMaster, code sync, timeout, error mapping — 52 contract tests against real localhost SSH (S03)"
  - id: R029
    from_status: active
    to_status: validated
    proof: "DockerBackend with local/remote paths, GPU passthrough, exit code mapping — 79 contract tests via mock docker binary (S04)"
  - id: R030
    from_status: active
    to_status: validated
    proof: "runExperimentPostProcess dispatches through resolveBackend → backend.runEval; 73 eval-runner tests pass unchanged (S01)"
  - id: R031
    from_status: active
    to_status: validated
    proof: "validateComputeConfig in parseCampaignConfig rejects SSH without host/workDir, Docker without image, unknown types — 18 assertions (S05)"
  - id: R032
    from_status: active
    to_status: validated
    proof: "pushExperimentBranch with ls-remote pre-check and post-push verification — 7 scenarios, 23 assertions (S02)"
  - id: R033
    from_status: active
    to_status: validated
    proof: "checkSSHConnectivity and checkDockerDaemon use OS-native binaries, structured error returns (S05)"
  - id: R034
    from_status: active
    to_status: validated
    proof: "try/catch in eval-runner wraps resolveBackend + eval loop → discard ExperimentResult with revert + JSONL — 10 assertions (S05)"
  - id: R035
    from_status: active
    to_status: validated
    proof: "End-to-end dispatch proves timeout flows config → resolveBackend → backend.runEval; SSH remote timeout + Docker container timeout — 19 assertions (S05)"
duration: 5 slices
verification_result: passed
completed_at: 2026-03-15
---

# M004: Remote Compute Backends

**Pluggable compute backend abstraction decouples eval execution from the local machine — SSH, Docker, and Local backends with git code sync, pre-flight checks, and graceful error handling, proven by 254 contract/integration test assertions.**

## What Happened

Five slices built bottom-up from interface to integration.

**S01** created the `ComputeBackend` interface with synchronous `runEval(opts) → RunEvalResult`, `LocalBackend` wrapping existing `spawnSync` logic, and `resolveBackend()` factory with TypeScript exhaustiveness guard. Wired dispatch into `runExperimentPostProcess` — all 73 existing eval-runner tests pass unchanged, proving transparent integration.

**S02** added `pushExperimentBranch()` for git code sync — six-step flow (get branch, get HEAD, ls-remote check, push, ls-remote verify) with structured `SyncResult` that never throws. Pre-push check distinguishes already-up-to-date from needing push. Post-push verification ensures the remote actually has the commit.

**S03** built `SSHBackend` using native `ssh` binary with ControlMaster connection reuse. Flow: push experiment branch → detect branch → build env prefix with shell quoting → assemble remote command (cd, git fetch+reset, timeout eval) → spawnSync ssh → map exit codes (124=remote timeout, 255=connection error, ETIMEDOUT=safety-net). Proven by 52 contract tests against real localhost SSH — no mocking.

**S04** built `DockerBackend` with two code paths: local (volume mount, no git push) and remote (git clone inside container via `docker -H`). GPU passthrough via `--gpus` flag. Docker-specific exit code mapping (125=daemon error, 126=not invokable, 127=not found). Safety-net timeout at +60s (vs SSH's +30s) for image pull overhead. 79 contract tests via mock docker binary on PATH.

**S05** wired everything together: `validateComputeConfig()` in `parseCampaignConfig` catches invalid configs at load time. `checkSSHConnectivity()` and `checkDockerDaemon()` pre-flight helpers surface actionable messages before eval. Try/catch wrapping in `runExperimentPostProcess` turns any backend error into a clean discard with revert + JSONL logging. End-to-end dispatch test proves config → backend resolution → eval execution → result return.

## Cross-Slice Verification

**Success criterion: SSH campaign runs eval remotely and produces correct keep/discard**
→ SSHBackend proven by 52 contract tests against real localhost SSH: successful eval returns stdout/metrics, command failure forwards exit code, remote timeout (exit 124) produces `timedOut: true`, connection error (exit 255) returns structured stderr. Code sync verified via git state comparison in tests.

**Success criterion: Docker campaign runs eval in container and produces correct keep/discard**
→ DockerBackend proven by 79 contract tests: local path assembles correct `docker run` with volume mount, remote path includes `git clone` + checkout by ref, GPU flag present when configured / absent when not, env vars forwarded, all exit codes mapped to structured results.

**Success criterion: No `compute` field works identically to today**
→ `resolveBackend(undefined)` returns `LocalBackend`. All 73 existing eval-runner tests pass unchanged (verified by test run). `runExperimentPostProcess` dispatch is transparent — same `RunEvalResult` shape from all backends.

**Success criterion: Backend failures produce clean discards, not crashes**
→ Try/catch in eval-runner produces discard `ExperimentResult` with `revertExperiment()` + `appendExperimentLog()`. Pre-flight failures → "Pre-flight failed:" prefix. Backend throws → "backend error:" prefix. 10 error wrapping assertions in config-integration tests.

**Success criterion: ComputeBackend interface is extensible**
→ `resolveBackend()` uses TypeScript exhaustiveness guard (`const _exhaustive: never = config`). Adding a new `ComputeConfig` variant without a corresponding case is a compile error. New backend = add union variant + case + implementation. No eval pipeline modifications needed.

**Test totals verified by running all suites:**
- compute-backend.test.ts: 45 passed ✅
- code-sync.test.ts: 23 passed ✅
- ssh-backend.test.ts: 52 passed ✅
- docker-backend.test.ts: 79 passed ✅
- config-integration.test.ts: 55 passed ✅
- eval-runner.test.ts: 73 passed (backward compat) ✅

## Requirement Changes

- R027 (Compute Backend Interface): active → validated — ComputeBackend interface, LocalBackend, resolveBackend factory, 45 contract tests (S01)
- R028 (SSH Compute Backend): active → validated — SSHBackend with ControlMaster, code sync, timeout, error mapping, 52 tests against real SSH (S03)
- R029 (Docker Compute Backend): active → validated — DockerBackend local+remote paths, GPU passthrough, exit code mapping, 79 tests (S04)
- R030 (Eval Pipeline Integration): active → validated — Transparent dispatch through resolveBackend, 73 eval-runner tests unchanged (S01)
- R031 (Backend Configuration): active → validated — validateComputeConfig in parseCampaignConfig, 18 config validation assertions (S05)
- R032 (Code Sync via Git): active → validated — pushExperimentBranch with pre/post verification, 23 assertions (S02)
- R033 (Credential Management): active → validated — OS-native ssh/docker pre-flight checks, structured error returns (S05)
- R034 (Backend Failure Handling): active → validated — Error wrapping produces discards, not exceptions, 10 assertions (S05)
- R035 (Eval Timeout Forwarding): active → validated — Timeout flows config → backend → subprocess for all three backends, 19 assertions (S05)

## Forward Intelligence

### What the next milestone should know
- The `ComputeBackend` interface is synchronous — `runEval()` blocks. If a future backend (Modal, RunPod) is async by nature (submit job → poll for completion), it must be wrapped in a blocking loop to satisfy the interface contract.
- `resolveBackend()` is the single factory. Add a new backend by: (1) add variant to `ComputeConfig` union in types.ts, (2) add case in resolveBackend(), (3) add validation in `validateComputeConfig()` in state.ts.
- Git push is the code sync mechanism for all remote backends. If a backend can't use git (e.g., serverless function with no git), it needs its own sync strategy (zip upload, S3 artifact, etc.).
- Pre-flight checks are optional guardrails, not gates. If the pre-flight itself fails, the eval runs anyway and surfaces the real error.

### What's fragile
- SSH ControlPath default `/tmp/gsd-ssh-%r@%h:%p` — concurrent campaigns to the same host share the control socket. Per-campaign ControlPaths would fix this but aren't implemented.
- ConnectTimeout=10 is hardcoded in SSHBackend — tight for high-latency networks, may need to become configurable.
- Docker safety-net timeout (+60s) may not be enough for cold-start image pulls on slow networks.
- `shellQuote()` is duplicated in both ssh-backend.ts and docker-backend.ts — intentional to avoid shared module, but both must stay in sync if quoting rules change.

### Authoritative diagnostics
- `grep -n 'resolveBackend\|backend.runEval' src/resources/extensions/gsd/eval-runner.ts` — shows the 3 dispatch wiring lines
- `grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error' src/resources/extensions/gsd/state.ts src/resources/extensions/gsd/eval-runner.ts src/resources/extensions/gsd/compute-backend.ts` — all integration points
- Discard reasons always contain structured prefixes: `Pre-flight failed:` or `backend error:`
- Each backend test suite's last line shows pass/fail counts with `process.exit(1)` on failure

### What assumptions changed
- None — all five slices implemented according to plan. SSH exit codes, ControlMaster behavior, Docker exit code semantics, and git push/verify flows all worked as designed.

## Files Created/Modified

- `src/resources/extensions/gsd/compute-backend.ts` — ComputeBackend interface, LocalBackend, resolveBackend(), checkSSHConnectivity(), checkDockerDaemon()
- `src/resources/extensions/gsd/ssh-backend.ts` — SSHBackend class with runEval(), mapSSHResult(), shellQuote()
- `src/resources/extensions/gsd/docker-backend.ts` — DockerBackend class with runEval(), mapDockerResult(), shellQuote()
- `src/resources/extensions/gsd/code-sync.ts` — pushExperimentBranch() with pre/post ls-remote verification
- `src/resources/extensions/gsd/types.ts` — ComputeConfig union (local/ssh/docker), SyncResult interface
- `src/resources/extensions/gsd/eval-runner.ts` — Backend dispatch in runExperimentPostProcess, error wrapping, pre-flight checks
- `src/resources/extensions/gsd/state.ts` — validateComputeConfig() in parseCampaignConfig
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 assertions: interface contract, factory routing, dispatch parity
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — 23 assertions: push/verify, error paths, custom remote
- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — 52 assertions: real localhost SSH, timeout, connection error, ControlMaster
- `src/resources/extensions/gsd/tests/docker-backend.test.ts` — 79 assertions: mock binary, local/remote paths, GPU, exit codes
- `src/resources/extensions/gsd/tests/config-integration.test.ts` — 55 assertions: validation, pre-flight, error wrapping, end-to-end
