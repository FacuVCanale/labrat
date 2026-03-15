---
estimated_steps: 5
estimated_files: 1
---

# T02: Contract tests proving SSH eval scenarios against localhost

**Slice:** S03 — SSH Compute Backend
**Milestone:** M004

## Description

Write a comprehensive contract test suite for SSHBackend that exercises real SSH to localhost — no mocking. Tests prove the full behavior matrix: success, failure, timeout (both remote and safety-net), connection error, env forwarding, code sync integration, and ControlMaster reuse. Follow the established test pattern from compute-backend.test.ts and code-sync.test.ts.

## Steps

1. Create `ssh-backend.test.ts` with standard test harness (assert/assertEq helpers, passed/failed counters, cleanup, summary with process.exit(1) on failure)
2. Implement `setupRepoWithBareRemote()` helper (reuse pattern from code-sync.test.ts) for tests that need git state
3. Write test groups:
   - Successful remote eval: SSH to localhost, run `echo '{"metric":1}'`, verify stdout/exitCode/timedOut
   - Remote command failure: run `exit 42`, verify exitCode=42, stderr forwarded
   - Remote timeout: run `sleep 999` with short timeout, verify exit 124 → timedOut:true
   - SpawnSync safety-net timeout: set extremely low spawnSync timeout, verify timedOut:true
   - SSH connection error: connect to 192.0.2.1 (TEST-NET, unreachable), verify exit 255 and error in stderr
   - Env var forwarding: pass custom env, verify visible in remote output
   - Code sync before eval: setup bare+clone repos, make commit, verify SSHBackend sees it on remote
   - Code sync failure: detached HEAD → structured error, not crash
   - ControlMaster reuse: two evals on same SSHBackend, second should reuse connection
   - RunEvalResult shape: verify all 5 fields present with correct types across success/failure/timeout
   - Factory routing: `resolveBackend({ type: 'ssh', ... })` returns SSHBackend instance
4. Run full test suite, fix any failures
5. Run existing compute-backend.test.ts to confirm no regressions

## Must-Haves

- [ ] ≥30 assertions covering all SSH outcome types
- [ ] Real SSH to localhost — no mock/stub subprocess
- [ ] Git-based code sync test with bare remote setup
- [ ] Timeout test proves both remote `timeout` command and spawnSync safety-net paths
- [ ] Connection error test uses unreachable host (192.0.2.1), not localhost
- [ ] All tests clean up tmpdir and ControlMaster sockets
- [ ] Test file follows project convention: custom assert helpers, summary, process.exit(1) on failure

## Verification

- `npx tsx src/resources/extensions/gsd/tests/ssh-backend.test.ts` — all pass, 0 fail
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 pass, 0 fail (no regression)

## Inputs

- `src/resources/extensions/gsd/ssh-backend.ts` — SSHBackend class from T01
- `src/resources/extensions/gsd/compute-backend.ts` — resolveBackend factory with SSH case from T01
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — test pattern to follow
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — setupRepoWithBareRemote() pattern

## Expected Output

- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — ≥30 assertions, 10+ test groups, all passing

## Observability Impact

- **Test output signals:** Each test group prints its label before running; final summary shows `N tests: N passed, N failed` with `process.exit(1)` on any failure. A future agent runs the file and reads the last line.
- **Failure diagnostics:** `FAIL: <message> — expected X, got Y` lines pinpoint exact assertion failures with expected vs actual values.
- **SSH diagnostic surface:** Connection error test (192.0.2.1) proves that SSH stderr is preserved in `RunEvalResult.stderr` — agents can read the SSH error message directly.
- **Code sync failure visibility:** Detached HEAD test proves that `pushExperimentBranch` failures surface as structured `Code sync failed:` messages in stderr, not exceptions.
- **ControlMaster verification:** Socket check via `ssh -O check` proves connection reuse is active — a future agent can use the same technique to diagnose connection pooling issues.
