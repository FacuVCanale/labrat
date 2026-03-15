---
estimated_steps: 4
estimated_files: 1
---

# T02: Contract test suite with mock docker binary

**Slice:** S04 — Docker Compute Backend
**Milestone:** M004

## Description

Build comprehensive contract tests for DockerBackend using a mock `docker` shell script injected via `PATH` manipulation. The mock captures invocation args to a file and returns configurable exit codes, enabling full behavior matrix testing without a real Docker daemon. Follows the same test framework pattern as ssh-backend.test.ts (assert/assertEq helpers, test groups, pass/fail summary).

## Steps

1. Create mock docker script infrastructure:
   - Write a shell script that: checks `$1 == "run"`, writes all args to `$MOCK_DOCKER_ARGS_FILE`, reads exit code from `$MOCK_DOCKER_EXIT_CODE` (default 0), reads stdout from `$MOCK_DOCKER_STDOUT` (default empty), outputs to stdout/stderr as configured
   - Make executable, prepend its directory to `PATH` so DockerBackend's `spawnSync('docker', ...)` finds it
2. Write test groups covering the full behavior matrix:
   - **Local path:** successful eval with volume mount — verify args include `-v <cwd>:/workspace`, `-w /workspace`, `--rm`, image name, `timeout` wrapper
   - **Remote path:** successful eval with git clone — verify `pushExperimentBranch()` called (use setupRepoWithBareRemote), verify args include `-H <host>`, no `-v`, command includes `git clone` + `git checkout` + `timeout`
   - **Failure forwarding:** exit codes 1, 2, etc. forwarded in RunEvalResult.exitCode
   - **Timeout (exit 124):** timedOut:true in result
   - **Daemon error (exit 125):** stderr preserved, exitCode=125
   - **Command errors (exit 126, 127):** proper mapping with stderr
   - **GPU flag:** `--gpus` present when config.gpus set, absent when not
   - **Env forwarding:** `-e KEY=VALUE` args for each opts.env entry
   - **Extra volumes:** additional `-v` args from config.volumes
   - **Missing repoUrl:** dockerHost set but no repoUrl → structured error in stderr, no throw
   - **Safety-net timeout:** spawnSync ETIMEDOUT → timedOut:true (use real spawnSync with 1s timeout on mock that sleeps)
   - **RunEvalResult shape:** all five fields present for success, failure, timeout paths
   - **Factory routing:** `resolveBackend({ type: 'docker', image: 'test' })` returns DockerBackend instance
3. Implement cleanup: remove mock script dir after tests, restore PATH
4. Final summary line: `Passed: N, Failed: N` with `process.exit(failed > 0 ? 1 : 0)`

## Must-Haves

- [ ] Mock docker script captures args and returns configurable exit codes
- [ ] Local path args verified (volume mount, working dir, --rm, image, timeout wrapper)
- [ ] Remote path args verified (-H host, git clone, git checkout, timeout)
- [ ] Exit code mapping verified: 124 (timeout), 125 (daemon), 126 (not invokable), 127 (not found)
- [ ] GPU flag presence/absence verified
- [ ] Env forwarding via -e flags verified
- [ ] Missing repoUrl error tested
- [ ] Safety-net timeout produces timedOut:true
- [ ] Factory routing test
- [ ] All tests pass, 0 failures

## Verification

- `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — all pass, 0 fail
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 pass, 0 fail (no regression)

## Inputs

- `src/resources/extensions/gsd/docker-backend.ts` — the module under test (from T01)
- `src/resources/extensions/gsd/tests/ssh-backend.test.ts` — test pattern template (assert/assertEq, setupRepoWithBareRemote, cleanup)
- `src/resources/extensions/gsd/compute-backend.ts` — resolveBackend for factory routing test

## Observability Impact

- **Test diagnostics:** Each failing assertion prints `FAIL: <description> — expected <X>, got <Y>` to stderr with exact values for immediate diagnosis
- **Mock inspection:** `getCapturedArgs()` reads `/tmp/gsd-mock-docker-*/captured-args` — a future agent can inspect this file to see exactly what Docker CLI args were constructed
- **Exit code coverage:** Tests verify all mapped exit codes (124, 125, 126, 127) plus fallback messages, confirming the full diagnostic surface documented in docker-backend.ts header
- **Summary line:** Final output `N tests: N passed, N failed` with `process.exit(1)` on failure — CI-friendly signal

## Expected Output

- `src/resources/extensions/gsd/tests/docker-backend.test.ts` — new: comprehensive contract tests with mock docker, ~15 test groups, ~40-60 assertions
