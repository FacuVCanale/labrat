# S03: SSH Compute Backend

**Goal:** `SSHBackend` connects to a remote host via native ssh, syncs code via git, runs eval, returns structured `RunEvalResult` — with timeout enforcement and graceful error handling for connection failures.
**Demo:** Contract tests against real localhost SSH prove: successful eval, command failure, timeout kill, connection error, env forwarding, code sync, and ControlMaster reuse — all returning correct `RunEvalResult` shape.

## Must-Haves

- `SSHBackend` class implements `ComputeBackend` interface using native `ssh` binary via `spawnSync`
- Code sync: calls `pushExperimentBranch()` before SSH eval; push failure → structured error result, not throw
- Remote timeout: `timeout <secs>` command on remote, exit 124 → `timedOut: true`
- Safety-net timeout: `spawnSync` timeout (+30s buffer) catches hangs when remote `timeout` fails
- Connection error detection: SSH exit 255 without spawnSync ETIMEDOUT → connection error in stderr
- Env var forwarding: `opts.env` entries exported in remote command prefix
- ControlMaster for connection reuse: `ControlMaster=auto`, `ControlPath`, `ControlPersist=60`
- `SSHBackendConfig` type added to `ComputeConfig` union in types.ts
- `resolveBackend()` gains `case 'ssh'` returning `SSHBackend` instance
- All contract tests use real SSH to localhost — no mocking

## Proof Level

- This slice proves: contract (real subprocess behavior via localhost SSH)
- Real runtime required: yes (sshd + git on localhost)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — all assertions pass (target: ~30-40 assertions, 0 failures)
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — existing 45 assertions still pass
- `resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp/x' })` returns `SSHBackend` instance
- SSH connection error (unreachable host) produces `RunEvalResult` with error in stderr, not an exception

## Observability / Diagnostics

- Runtime signals: `RunEvalResult.stderr` contains SSH diagnostic output on connection failure; exit 124 maps to timedOut
- Inspection surfaces: `grep -n 'SSHBackend\|resolveBackend' src/resources/extensions/gsd/ssh-backend.ts compute-backend.ts` shows wiring
- Failure visibility: SSH exit 255 with error message in stderr; push failure in SyncResult.error propagated to RunEvalResult.stderr
- Redaction constraints: none (no secrets in code — SSH keys via ssh-agent/config)

## Integration Closure

- Upstream surfaces consumed: `ComputeBackend` interface + `ComputeEvalOpts` + `RunEvalResult` from compute-backend.ts/eval-runner.ts; `pushExperimentBranch()` from code-sync.ts; `ComputeConfig` union from types.ts
- New wiring introduced in this slice: `case 'ssh'` in `resolveBackend()`, `SSHBackendConfig` variant in `ComputeConfig` union
- What remains before the milestone is truly usable end-to-end: S04 (Docker backend), S05 (config validation, credential checks, integration test)

## Tasks

- [x] **T01: Implement SSHBackend class and wire into factory** `est:45m`
  - Why: Core implementation — the SSHBackend class, config type extension, and factory wiring. Without this, there's nothing to test.
  - Files: `src/resources/extensions/gsd/ssh-backend.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/compute-backend.ts`
  - Do: Create `SSHBackend` class implementing `ComputeBackend.runEval()` with: pushExperimentBranch before SSH, branch detection, remote command assembly (env exports → cd → git fetch+reset → timeout eval), spawnSync('ssh', args) with safety-net timeout, result mapping (exit 124 → timedOut, exit 255 → connection error). Build SSH args with BatchMode=yes, ControlMaster=auto, ControlPersist=60, ConnectTimeout=10. Add `SSHBackendConfig` to `ComputeConfig` union. Add `case 'ssh'` to `resolveBackend()`. Fix the pre-existing import of `RunEvalResult` from `./types.js` to `./eval-runner.js` in compute-backend.ts.
  - Verify: `npx tsx -e "import { resolveBackend } from './src/resources/extensions/gsd/compute-backend.ts'; const b = resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp' }); console.log(b.constructor.name)"` prints `SSHBackend`
  - Done when: SSHBackend class compiles, resolveBackend routes to it, existing compute-backend tests still pass

- [x] **T02: Contract tests proving SSH eval scenarios against localhost** `est:45m`
  - Why: The proof. Research identified 10+ test groups. Real SSH to localhost exercises actual subprocess behavior — no mocks means the tests prove what they claim.
  - Files: `src/resources/extensions/gsd/tests/ssh-backend.test.ts`
  - Do: Write contract tests following existing test pattern (custom assert/assertEq, summary at end, process.exit(1) on failure). Use `setupRepoWithBareRemote()` pattern from code-sync tests for git scenarios. Test groups: (1) successful remote eval, (2) remote command failure with exit code forwarding, (3) remote timeout via `timeout` command, (4) spawnSync safety-net timeout, (5) SSH connection error to unreachable host, (6) env var forwarding, (7) code sync before eval with git verification, (8) code sync failure → structured error, (9) ControlMaster reuse speed, (10) RunEvalResult shape for all outcome types, (11) resolveBackend factory routing for SSH config.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — all assertions pass, 0 failures
  - Done when: ≥30 assertions pass covering success, failure, timeout, connection error, env forwarding, code sync, and factory routing

## Files Likely Touched

- `src/resources/extensions/gsd/ssh-backend.ts`
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/compute-backend.ts`
- `src/resources/extensions/gsd/tests/ssh-backend.test.ts`
