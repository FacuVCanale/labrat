# S03: SSH Compute Backend — Research

**Date:** 2026-03-15

## Summary

SSHBackend is implementable with zero new dependencies using native `ssh` binary via `spawnSync`. The key insight from live testing: SSH cleanly forwards remote exit codes, stdout, and stderr through separate streams — exit 42 on remote becomes exit 42 locally. This means RunEvalResult can be populated without parsing SSH protocol output.

The timeout strategy is dual-layer: remote `timeout` command (exit 124 = timedOut) as primary enforcement, with spawnSync timeout as a safety net (+30s buffer). Connection failures are distinguishable: SSH exit 255 without spawnSync ETIMEDOUT error = connection problem. ControlMaster provides 30x speedup for repeated connections (tested: 666ms → 22ms on localhost), making it essential for multi-run evals.

Code sync is internal to SSHBackend — `pushExperimentBranch(opts.cwd)` before SSH, then `git fetch origin && git checkout <branch> && git reset --hard origin/<branch>` on the remote. This keeps the `ComputeBackend` interface unchanged.

Testing can use **real SSH to localhost** — sshd is running on this system, ed25519 key is configured. No SSH mocking needed. Contract tests will exercise actual ssh subprocess behavior.

## Recommendation

Implement `SSHBackend` as a standalone `ssh-backend.ts` module following the established `compute-backend.ts` patterns. The class holds SSH config (host, workDir, controlPath) and implements `ComputeBackend.runEval()` with this flow:

1. Push experiment branch via `pushExperimentBranch(opts.cwd)`
2. Build SSH args: BatchMode, ControlMaster, ConnectTimeout
3. Build remote command: env exports → cd workDir → git fetch+reset → `timeout <secs> <eval command>`
4. Execute via `spawnSync('ssh', args)` with safety-net timeout
5. Map result: exit 124 → timedOut, exit 255 (no ETIMEDOUT) → connection error, else forward exitCode

Extend `ComputeConfig` union with `{ type: 'ssh', host: string, workDir: string, controlPath?: string }`. Add `case 'ssh'` to `resolveBackend()` in `compute-backend.ts`.

Contract tests against real localhost SSH — no mocks, real subprocess behavior.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Git push before remote eval | `pushExperimentBranch()` in `code-sync.ts` | Already proven by S02 with 23 assertions. Handles detached HEAD, already-up-to-date, diverged branch. |
| Subprocess execution pattern | `spawnSync` from `node:child_process` | Same pattern as `LocalBackend` and `runEval()`. Zero dependencies. |
| Backend factory routing | `resolveBackend()` in `compute-backend.ts` | Exhaustiveness guard already enforces new backend handling. Just add a case. |
| SSH connection multiplexing | Native SSH ControlMaster (`-o ControlMaster=auto`) | Built into OpenSSH. 30x speedup proven in testing. No library needed. |

## Existing Code and Patterns

- `src/resources/extensions/gsd/compute-backend.ts` — `ComputeBackend` interface, `ComputeEvalOpts`, `LocalBackend`, `resolveBackend()`. SSHBackend implements same interface. Add case to factory.
- `src/resources/extensions/gsd/code-sync.ts` — `pushExperimentBranch(basePath, remote?)` returns structured `SyncResult`. SSHBackend calls this before SSH eval. Never throws on expected failures.
- `src/resources/extensions/gsd/types.ts` line 305 — `ComputeConfig = { type: 'local' }`. Extend to `| { type: 'ssh', host: string, workDir: string, controlPath?: string }`.
- `src/resources/extensions/gsd/eval-runner.ts` line 555 — `resolveBackend(config.compute)` dispatch point. No changes needed here — factory handles routing.
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — Test pattern: custom assert/assertEq helpers, tmpdir setup/teardown, self-contained summary. Follow this pattern.
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — `setupRepoWithBareRemote()` helper creates bare+clone git repos. Reuse or adapt for SSH tests that need git state.

## Constraints

- **Synchronous interface**: `ComputeBackend.runEval()` blocks and returns `RunEvalResult`. SSH via `spawnSync` is inherently blocking — no issue.
- **Native ssh binary only**: D064 mandates native CLI, no Node.js SSH libraries. `spawnSync('ssh', [...args])`.
- **RunEvalResult shape unchanged**: stdout, stderr, exitCode, signal, timedOut — same 5 fields. SSH must map its output to this shape.
- **Normal push only**: D063 says git push, no force-push. `pushExperimentBranch()` already enforces this.
- **Test runner**: Files use custom assert helpers with `process.exit(1)` on failure. No `node:test` import. Runs via `npm test` glob.
- **Import convention**: `.js` extension in imports (pi runtime bundler rewrites to `.ts` at test time via resolve-ts.mjs hook).

## Common Pitfalls

- **Exit code 255 ambiguity** — Both SSH connection errors and spawnSync timeout produce exit 255. Distinguish via `spawnSync` result's `error.code === 'ETIMEDOUT'` (present only for spawnSync timeout). Without this check, timeouts would be misreported as connection errors.
- **Shell escaping in SSH commands** — Eval commands with quotes, `$`, backticks need escaping when embedded in the SSH command string. Use `JSON.stringify()` or explicit escaping for the eval command portion. The `cd`, `git`, and `export` parts are controlled strings.
- **ControlMaster orphan sockets** — If the process crashes, the control socket stays in `/tmp`. Not harmful (subsequent connections with same path create a new one), but could accumulate. ControlPersist with a timeout (e.g., 60s) auto-cleans.
- **Remote `timeout` command availability** — Not all systems have GNU `timeout` (e.g., minimal Alpine). Detect with `which timeout` on first connection, fall back to spawnSync-only timeout. Or document as a requirement.
- **Remote git not configured** — The remote workDir must be a git clone with the right remote. SSHBackend can't set this up — it's user's responsibility. But the error path (git fetch fails) must produce a clear discard, not a crash.
- **RunEvalResult.signal field** — SSH doesn't forward signals. Remote timeout exits 124, not SIGTERM. Map: exit 124 → `timedOut: true, signal: null, exitCode: 124`. SpawnSync timeout → `timedOut: true, signal: null, exitCode: null`.

## Open Risks

- **Remote branch name discovery** — SSHBackend needs to know which branch to checkout on remote. Current branch from `git branch --show-current` on local, forwarded to remote `git checkout <branch>`. If local is on a weird branch name with special chars, the SSH command breaks. Low probability but worth a defensive check.
- **pushExperimentBranch failure handling** — If push fails (no remote, diverged), SSHBackend should return a discard-quality `RunEvalResult` (non-zero exitCode, error in stderr), not throw. This keeps the eval loop's error handling consistent.
- **ControlMaster + ConnectTimeout interaction** — When ControlMaster is active, ConnectTimeout applies to the first connection only. Subsequent connections via the socket are instant. If the master connection drops, the next connection attempt may hang without ConnectTimeout. ServerAliveInterval on the master mitigates this.
- **Large stdout/stderr from remote** — SSH doesn't have a maxBuffer equivalent. But spawnSync does (set to 10MB in LocalBackend). Same limit applies to the ssh subprocess. Should be fine.

## Requirements Targeted

| Requirement | Role | What this slice must prove |
|-------------|------|---------------------------|
| R028 — SSH Compute Backend | Primary owner | SSHBackend connects, syncs code, runs eval, returns structured result. Timeout kills remote process. Connection errors produce discard. |
| R034 — Backend Failure Handling | Supporting | SSH connection failures (refused, timeout, auth) produce structured RunEvalResult with error info, not unhandled exceptions. |
| R035 — Eval Timeout Forwarding | Supporting | Campaign eval timeout forwarded to remote via `timeout` command. Remote process killed on timeout. timedOut flag set correctly. |

## Test Strategy

Real SSH to localhost — no mocking. sshd is running, ed25519 key auth is configured. Contract tests exercise actual subprocess behavior.

**Scenarios (estimated ~10 test groups, ~30-40 assertions):**

1. **Successful remote eval** — SSH to localhost, run `echo '{"metric":1}'`, verify stdout/exitCode/timedOut
2. **Remote command failure** — Run `exit 42`, verify exitCode=42, stderr forwarded
3. **Remote eval timeout** — Run `timeout <secs> sleep 999`, verify exit 124 → timedOut:true
4. **SpawnSync safety-net timeout** — Force spawnSync timeout (set very low), verify timedOut:true
5. **SSH connection error** — Connect to unreachable host (192.0.2.1), verify exit 255 → error in stderr
6. **Env var forwarding** — Pass custom env, verify it's visible in remote command output
7. **Code sync before eval** — Setup bare+clone repos, make local commit, push, verify SSHBackend sees new code on remote
8. **Code sync failure** — Detached HEAD or bad remote → structured error, not throw
9. **ControlMaster reuse** — Two evals on same SSHBackend instance, second should be faster (connection reused)
10. **RunEvalResult shape** — Verify all 5 fields present with correct types for success/failure/timeout cases
11. **resolveBackend({ type: 'ssh', ... })** — Factory returns SSHBackend instance

## Implementation Sketch

```
ssh-backend.ts:
  SSHBackend class implements ComputeBackend
    constructor(config: SSHBackendConfig)
    runEval(opts: ComputeEvalOpts): RunEvalResult
      1. pushExperimentBranch(opts.cwd) — if error, return early with error result
      2. get current branch name
      3. build env export prefix from opts.env
      4. build remote command: cd workDir && git fetch && git reset && timeout <secs> <command>
      5. spawnSync('ssh', [...sshArgs, host, remoteCommand], { timeout: safety })
      6. map result → RunEvalResult (124 → timedOut, 255 → connection error, else forward)
    cleanup() — -O exit to close ControlMaster
    private buildSSHArgs(): string[] — BatchMode, ControlMaster, ControlPath, ConnectTimeout

types.ts:
  ComputeConfig union: add | { type: 'ssh', host: string, workDir: string, controlPath?: string }

compute-backend.ts:
  resolveBackend(): add case 'ssh' → new SSHBackend(config)
```

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| SSH (native binary via child_process) | searched "SSH" | none relevant — all results were server setup/penetration testing, not programmatic subprocess execution |

## Sources

- SSH ControlMaster behavior: live testing on this system (OpenSSH_9.6p1), 30x speedup measured
- SSH exit code forwarding: live testing confirms remote exit codes pass through SSH unchanged
- spawnSync timeout vs SSH error distinction: live testing confirms `error.code === 'ETIMEDOUT'` only present for spawnSync timeout
- GNU `timeout` command: exit code 124 on timeout, confirmed via live test
- Existing codebase patterns: `compute-backend.ts`, `code-sync.ts`, `eval-runner.ts` examined
