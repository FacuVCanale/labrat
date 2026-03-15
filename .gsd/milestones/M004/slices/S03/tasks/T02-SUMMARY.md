---
id: T02
parent: S03
milestone: M004
provides:
  - Contract test suite (52 assertions) proving SSHBackend behavior matrix via real SSH to localhost
key_files:
  - src/resources/extensions/gsd/tests/ssh-backend.test.ts
key_decisions:
  - Safety-net timeout path tested via direct spawnSync with short timeout rather than end-to-end through SSHBackend (31s minimum through SSHBackend would be impractical for CI)
  - ControlMaster reuse verified via `ssh -O check` socket probe between two eval calls
patterns_established:
  - setupRepoWithBareRemote() + second clone as "remote workDir" for SSH code sync tests
  - cleanupControlSocket() via `ssh -O exit` for ControlMaster socket teardown
  - Per-test unique controlPath with timestamp to avoid socket collisions
observability_surfaces:
  - Test output: final line `N tests: N passed, N failed` with process.exit(1) on failure
  - FAIL lines include expected vs actual values for debugging
  - SSH stderr preservation verified in connection error test (192.0.2.1)
  - Code sync failure visibility verified (detached HEAD → structured error in stderr)
duration: 10m
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T02: Contract tests proving SSH eval scenarios against localhost

**52 assertions across 13 test groups prove SSHBackend's full behavior matrix via real SSH to localhost — no mocking.**

## What Happened

Built `ssh-backend.test.ts` following the established test pattern (custom assert/assertEq, passed/failed counters, cleanup, summary with process.exit(1) on failure). Used `setupRepoWithBareRemote()` from the code-sync test pattern for git-based scenarios.

Test groups implemented:
1. **Successful remote eval** — echo JSON, verify stdout/exitCode/timedOut/signal/stderr (5 assertions)
2. **Remote command failure** — exit 42, verify exitCode/stderr/timedOut/signal (4 assertions)
3. **Remote timeout** — sleep 999 with 1s timeout, verify exit 124/timedOut/signal (3 assertions)
4. **SpawnSync safety-net** — direct spawnSync with 2s timeout against trapped-SIGTERM command, proves signal-based kill path (2 assertions)
5. **SSH connection error** — 192.0.2.1 unreachable, verify exit 255/stderr/timedOut/signal (4 assertions)
6. **Env var forwarding** — custom env vars visible in remote output (3 assertions)
7. **Code sync before eval** — new commit synced via pushExperimentBranch, marker file visible on remote (3 assertions)
8. **Code sync failure** — detached HEAD → structured error message, not crash (3 assertions)
9. **ControlMaster reuse** — two evals, socket active between them via `ssh -O check` (5 assertions)
10. **RunEvalResult shape (success)** — exactly 5 fields with correct types (6 assertions)
11. **RunEvalResult shape (failure)** — same shape on error path (6 assertions)
12. **RunEvalResult shape (timeout)** — same shape on timeout path (6 assertions)
13. **Factory routing** — resolveBackend with SSH config returns SSHBackend instance (2 assertions)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — **52 passed, 0 failed** ✅
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** ✅ (no regression)
- Slice verification: all 4 checks pass (test suite, regression suite, factory routing, connection error shape)

## Diagnostics

- Run `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — last line shows pass/fail counts
- On failure, `FAIL:` lines include assertion name with expected vs actual values
- Connection error test against 192.0.2.1 takes ~10s due to ConnectTimeout — this is expected
- Safety-net test takes ~2s (direct spawnSync, not through SSHBackend's 31s buffer)
- Each test uses unique ControlPath with timestamp to prevent socket collisions across parallel runs

## Deviations

Safety-net timeout test uses direct `spawnSync` with a 2s timeout rather than going through SSHBackend end-to-end. SSHBackend calculates safety-net as `(timeoutSecs + 30) * 1000` — minimum 31 seconds even with timeoutSecs=0. The direct test proves the same signal-based kill path (SIGTERM/SIGKILL/ETIMEDOUT) that mapSSHResult handles.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — New: 52 assertions across 13 test groups covering full SSH behavior matrix
- `.gsd/milestones/M004/slices/S03/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
