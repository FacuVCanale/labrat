# S03: SSH Compute Backend — UAT

**Milestone:** M004
**Written:** 2026-03-15

## UAT Type

- UAT mode: live-runtime
- Why this mode is sufficient: SSHBackend requires real SSH connectivity and git operations — artifact inspection alone cannot prove subprocess behavior, timeout enforcement, or connection error handling

## Preconditions

- `sshd` running on localhost and accepting connections for the current user (passwordless via key or authorized_keys)
- `git` installed and accessible on the local machine
- Node.js with `npx tsx` available
- Repository checked out at the gsd/M004/S03 branch (or equivalent with ssh-backend.ts present)
- SSH key or agent configured for localhost access (no password prompts)

## Smoke Test

Run the full contract test suite:
```bash
npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts
```
**Expected:** Last line shows `52 tests: 52 passed, 0 failed`, exit code 0.

## Test Cases

### 1. Successful Remote Eval via SSH

1. The test suite creates a temp git repo with a bare remote
2. SSHBackend.runEval() executes `echo '{"accuracy": 0.95}'` on localhost via ssh
3. **Expected:** stdout contains the JSON string, exitCode is 0, timedOut is false, signal is null, stderr is empty or contains only SSH diagnostics

### 2. Remote Command Failure with Exit Code Forwarding

1. SSHBackend.runEval() executes a command that exits with code 42 and writes to stderr
2. **Expected:** exitCode is 42 (not 0, not 1, exactly 42), stderr contains the error message, timedOut is false

### 3. Remote Timeout Enforcement

1. SSHBackend.runEval() executes `sleep 999` with a 1-second timeout
2. The remote `timeout` command kills the sleep process
3. **Expected:** exitCode is 124, timedOut is true, execution completes in ~1-2 seconds (not 999)

### 4. SpawnSync Safety-Net Timeout

1. A direct spawnSync call with a 2-second timeout against a command that traps SIGTERM and ignores it
2. **Expected:** spawnSync returns with signal SIGTERM (or SIGKILL), error.code is 'ETIMEDOUT', proving the safety-net kill path works

### 5. SSH Connection Error (Unreachable Host)

1. SSHBackend.runEval() targets host 192.0.2.1 (RFC 5737 TEST-NET, guaranteed unreachable)
2. **Expected:** exitCode is 255, stderr contains SSH error message (e.g., "Connection timed out"), timedOut is false, signal is null — result is a structured RunEvalResult, not an unhandled exception

### 6. Environment Variable Forwarding

1. SSHBackend.runEval() with opts.env containing custom variables (e.g., `MY_VAR=hello_labrat`, `CUDA_VISIBLE_DEVICES=0,1`)
2. Remote command executes `echo $MY_VAR` and `echo $CUDA_VISIBLE_DEVICES`
3. **Expected:** stdout contains the env var values, proving the env prefix export mechanism works

### 7. Code Sync Before Eval with Git Verification

1. Create a git repo with bare remote, add a new commit with a marker file
2. SSHBackend.runEval() calls pushExperimentBranch() then runs eval on localhost using a second clone as workDir
3. Remote command checks for the marker file (e.g., `cat marker.txt`)
4. **Expected:** marker file content visible in stdout, proving the push → fetch → reset flow synced the code

### 8. Code Sync Failure Produces Structured Error

1. Detach HEAD in the local repo (no branch to push)
2. SSHBackend.runEval() attempts code sync
3. **Expected:** Returns a RunEvalResult with "Code sync failed:" in stderr and a non-zero exitCode — does NOT throw an exception

### 9. ControlMaster Connection Reuse

1. Run two SSHBackend.runEval() calls in sequence to the same host with the same controlPath
2. Between calls, probe the control socket with `ssh -O check`
3. **Expected:** Both evals succeed, `ssh -O check` confirms the socket is active between calls (ControlMaster reuse working)

### 10. Factory Routing

1. Call `resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp' })`
2. **Expected:** Returns an object whose constructor.name is 'SSHBackend' and has a `runEval` function

### 11. Regression Check — Existing Compute Backend Tests

1. Run `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts`
2. **Expected:** 45 passed, 0 failed — no regression from SSHBackend additions

## Edge Cases

### Connection Error Does Not Crash the Process
1. SSHBackend.runEval() with host 192.0.2.1 (unreachable)
2. **Expected:** Returns RunEvalResult with error details — the process continues, no unhandled exception. This is critical for overnight runs where network blips must not crash the orchestrator.

### Env Values with Special Characters
1. SSHBackend.runEval() with env containing values with spaces, quotes, or shell metacharacters
2. **Expected:** shellQuote() properly escapes values; remote command sees the intended strings. (Covered by env forwarding test — verify with values like `it's a "test"`)

### Detached HEAD Code Sync
1. `git checkout --detach HEAD` before calling SSHBackend.runEval()
2. **Expected:** Code sync detects "not on a branch" and returns structured error — does not hang or crash

## Failure Signals

- Test suite reports any failures: look for `FAIL:` lines with expected vs actual values
- Exit code 1 from test runner
- SSH errors in stderr that don't map to structured RunEvalResult (indicates unhandled exception path)
- ControlMaster socket not created (check `/tmp/gsd-ssh-*` for socket files)
- Code sync test failing with "marker file not found" (push/fetch/reset chain broken)

## Requirements Proved By This UAT

- R028 (SSH Compute Backend) — All 13 test groups prove SSHBackend connects, syncs code, executes eval, returns structured results, handles timeout and connection errors
- R034 (Backend Failure Handling) — Connection error and code sync failure tests prove graceful degradation to structured RunEvalResult
- R035 (Eval Timeout Forwarding) — Remote timeout and safety-net timeout tests prove timeout is enforced on remote process

## Not Proven By This UAT

- End-to-end eval pipeline dispatch with SSH backend (S05 integration test)
- Docker backend behavior (S04)
- CampaignConfig.compute field parsing and validation (S05)
- SSH to a real remote host (different machine) — tests use localhost only
- Long-running eval over SSH with network interruption mid-eval (would require network simulation)

## Notes for Tester

- The connection error test (192.0.2.1) takes ~10 seconds due to ConnectTimeout=10. This is expected behavior, not a hang.
- The safety-net timeout test uses direct spawnSync, not SSHBackend — this is intentional (SSHBackend's +30s buffer would make the test impractical).
- ControlMaster sockets are cleaned up after tests via `ssh -O exit`. If tests crash mid-run, stale sockets may exist at `/tmp/gsd-ssh-*` — safe to delete.
- Tests require passwordless SSH to localhost. If `ssh localhost echo ok` prompts for a password, tests will hang or fail.
