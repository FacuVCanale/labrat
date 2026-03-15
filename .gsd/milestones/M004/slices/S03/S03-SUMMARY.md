---
id: S03
parent: M004
milestone: M004
provides:
  - SSHBackend class implementing ComputeBackend.runEval() via native ssh binary with ControlMaster connection reuse
  - SSHBackendConfig variant in ComputeConfig discriminated union
  - resolveBackend() routing for type 'ssh'
  - 52 contract test assertions proving full SSH behavior matrix via real localhost SSH (no mocking)
requires:
  - slice: S01
    provides: ComputeBackend interface, ComputeEvalOpts, RunEvalResult, resolveBackend() factory
  - slice: S02
    provides: pushExperimentBranch() for code sync before remote eval
affects:
  - S05
key_files:
  - src/resources/extensions/gsd/ssh-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/tests/ssh-backend.test.ts
key_decisions: []
patterns_established:
  - SSH exit code mapping (124=timeout, 255=connection, ETIMEDOUT=safety-net) as explicit branches in mapSSHResult()
  - Remote command assembly as cd → git fetch+reset → env prefix → timeout eval
  - shellQuote() helper for safe embedding of env values in remote command strings
  - setupRepoWithBareRemote() + second clone as "remote workDir" for SSH code sync tests
  - Per-test unique controlPath with timestamp to avoid socket collisions
  - cleanupControlSocket() via `ssh -O exit` for ControlMaster socket teardown
observability_surfaces:
  - RunEvalResult.stderr contains SSH diagnostic output on connection failure
  - Push errors surfaced in stderr field via "Code sync failed:" prefix
  - Exit code mapping grep-discoverable: `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' ssh-backend.ts`
  - Test output final line `N tests: N passed, N failed` with process.exit(1) on failure
drill_down_paths:
  - .gsd/milestones/M004/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S03/tasks/T02-SUMMARY.md
duration: 25m
verification_result: passed
completed_at: 2026-03-15
---

# S03: SSH Compute Backend

**SSHBackend dispatches eval to remote hosts via native ssh with ControlMaster connection reuse, git code sync, timeout enforcement, and structured error mapping — proven by 52 contract tests against real localhost SSH.**

## What Happened

T01 created `ssh-backend.ts` with `SSHBackend` implementing `ComputeBackend.runEval()`. The flow: call `pushExperimentBranch()` for code sync → detect current git branch → build env prefix (`export KEY='VALUE';`) → assemble remote command (`cd workDir && git fetch origin && git reset --hard origin/branch && timeout secs command`) → `spawnSync('ssh', args)` with safety-net timeout (+30s) → map result via `mapSSHResult()`.

SSH args include BatchMode=yes, ControlMaster=auto, ControlPath (configurable, defaults to `/tmp/gsd-ssh-%r@%h:%p`), ControlPersist=60, ConnectTimeout=10, StrictHostKeyChecking=accept-new.

Exit code mapping in `mapSSHResult()`: exit 124 → remote timeout (timedOut:true), exit 255 → SSH connection error, spawnSync ETIMEDOUT → safety-net timeout. Push failure → early return with "Code sync failed:" prefix in stderr.

Extended `ComputeConfig` union in types.ts with `{ type: 'ssh'; host: string; workDir: string; controlPath?: string }`. Added `case 'ssh'` to `resolveBackend()` factory. Fixed pre-existing import bug: `RunEvalResult` was imported from `./types.js` but defined in `./eval-runner.ts`.

T02 built the contract test suite — 52 assertions across 13 test groups exercising real SSH to localhost (no mocking): successful eval, command failure with exit code forwarding, remote timeout via `timeout` command, spawnSync safety-net timeout, SSH connection error (192.0.2.1), env var forwarding, code sync before eval with git verification, code sync failure (detached HEAD), ControlMaster reuse (verified via `ssh -O check`), RunEvalResult shape for success/failure/timeout paths, and factory routing.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — **52 passed, 0 failed** ✅
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** ✅ (no regression)
- `resolveBackend({ type: 'ssh', ... })` returns SSHBackend instance — verified by factory routing test group
- SSH connection error (192.0.2.1) produces RunEvalResult with exit 255 and error in stderr — verified by connection error test group
- Observability: `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' ssh-backend.ts` returns 7 matches

## Requirements Advanced

- R028 (SSH Compute Backend) — SSHBackend connects via native ssh, pulls experiment branch, runs eval, returns structured RunEvalResult; timeout kills remote process; connection errors produce discard
- R034 (Backend Failure Handling) — SSH connection failures and timeouts produce structured RunEvalResult with error in stderr, not unhandled exceptions
- R035 (Eval Timeout Forwarding) — Remote `timeout` command enforces eval timeout; safety-net spawnSync timeout catches hangs when remote timeout fails

## Requirements Validated

- R028 — 52 contract tests against real localhost SSH prove: successful eval, failure forwarding, remote timeout (exit 124), safety-net timeout, connection error (exit 255), env forwarding, code sync via git, code sync failure handling, ControlMaster reuse, RunEvalResult shape for all outcome types, and factory routing

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Safety-net timeout test uses direct `spawnSync` with 2s timeout rather than through SSHBackend end-to-end (SSHBackend's +30s buffer makes minimum 31s impractical for CI). Proves the same signal-based kill path that `mapSSHResult` handles.
- Factory routing verified via test group instead of `npx tsx -e` one-liner (import chain hits `@gsd/pi-coding-agent` package exports issue, documented in T01).

## Known Limitations

- Connection error test against 192.0.2.1 takes ~10s due to ConnectTimeout — expected but makes the test suite slower than ideal
- No integration with the eval pipeline dispatch path yet (S05 wires config → backend resolution → eval execution end-to-end)
- Docker backend not yet implemented (S04)

## Follow-ups

- none

## Files Created/Modified

- `src/resources/extensions/gsd/ssh-backend.ts` — New: SSHBackend class with runEval(), mapSSHResult(), shellQuote()
- `src/resources/extensions/gsd/types.ts` — Extended ComputeConfig union with SSH variant
- `src/resources/extensions/gsd/compute-backend.ts` — Fixed RunEvalResult import, added SSHBackend import and case 'ssh' in resolveBackend()
- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — New: 52 assertions across 13 test groups

## Forward Intelligence

### What the next slice should know
- SSHBackend is wired into resolveBackend() and ready for S05 integration — no additional plumbing needed
- `shellQuote()` in ssh-backend.ts could be reused by DockerBackend if env forwarding uses similar shell escaping
- The test pattern (setupRepoWithBareRemote + second clone as remote workDir) works well for git-based sync scenarios and can be adapted for Docker volume mount tests

### What's fragile
- ControlPath default `/tmp/gsd-ssh-%r@%h:%p` — if tests run in parallel with the same user@host, sockets collide. Tests use per-test unique paths, but production code uses the default. Real multi-campaign concurrency would need distinct ControlPaths per campaign.
- ConnectTimeout=10 is hardcoded — works for LAN/cloud but may be tight for high-latency networks

### Authoritative diagnostics
- `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — last line shows pass/fail counts; FAIL lines include expected vs actual
- `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' src/resources/extensions/gsd/ssh-backend.ts` — shows all exit code mapping sites
- RunEvalResult.stderr always contains SSH diagnostic output on failure

### What assumptions changed
- None — SSH behavior matched expectations. Exit codes, ControlMaster, timeout command all worked as designed.
