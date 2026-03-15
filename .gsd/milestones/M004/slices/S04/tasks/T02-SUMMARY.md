---
id: T02
parent: S04
milestone: M004
provides:
  - Comprehensive contract test suite for DockerBackend with 79 assertions across 15 test groups using mock docker binary
key_files:
  - src/resources/extensions/gsd/tests/docker-backend.test.ts
key_decisions:
  - Mock docker as a shell script on PATH (captures args to file, returns configurable exit/stdout/stderr) rather than module-level mocking — tests the real spawnSync call path
  - Safety-net timeout tested via direct spawnSync with short timeout on a sleeper script (mirrors ssh-backend.test.ts pattern) since DockerBackend's safety-net is hardcoded at timeoutSecs+60s
patterns_established:
  - Mock binary pattern: write shell script to temp dir, prepend to PATH, reset state between tests via file cleanup
  - Same assert/assertEq/cleanup test harness as ssh-backend.test.ts and compute-backend.test.ts
observability_surfaces:
  - Each failing assertion prints `FAIL: <description> — expected <X>, got <Y>` with exact values
  - Summary line `N tests: N passed, N failed` with exit code 1 on failure
  - Mock captured-args file available for manual inspection during debugging
duration: 1 task
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T02: Contract test suite with mock docker binary

**Built 79-assertion contract test suite for DockerBackend covering local/remote paths, all exit code mappings, GPU/env/volume forwarding, error handling, result shape, and factory routing — all via mock docker binary on PATH.**

## What Happened

Created `docker-backend.test.ts` following the established test pattern from ssh-backend.test.ts. The mock docker infrastructure writes a shell script to a temp directory and prepends it to `process.env.PATH` so DockerBackend's `spawnSync('docker', ...)` finds it. The mock captures all invocation args to a file and returns configurable exit codes, stdout, and stderr.

Test groups cover:
- **Local path** (8 assertions): volume mount `-v cwd:/workspace`, working dir `-w /workspace`, `--rm`, image name, timeout wrapper
- **Remote path** (9 assertions): `-H host`, git clone + checkout in command, no volume mount, push via setupRepoWithBareRemote
- **Failure forwarding** (4 assertions): exit codes 1 and 2 forwarded as-is
- **Exit 124 timeout** (3 assertions): `timedOut:true`, `exitCode:124`
- **Exit 125 daemon error** (4 assertions): stderr preserved, fallback message when empty
- **Exit 126/127 command errors** (8 assertions): stderr preserved, fallback messages
- **GPU flag** (3 assertions): present when set, absent when not, works on remote path
- **Env forwarding** (3 assertions): `-e KEY=VALUE` pairs present, absent when no env
- **Extra volumes** (3 assertions): additional `-v` args from config.volumes
- **Missing repoUrl** (4 assertions): structured error in stderr, no throw
- **Safety-net timeout** (2 assertions): direct spawnSync kill path produces timedOut signal
- **RunEvalResult shape** (18 assertions): 5 fields with correct types for success/failure/timeout
- **Factory routing** (2 assertions): resolveBackend returns DockerBackend, has runEval method

## Verification

- `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — 79 passed, 0 failed ✓
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 passed, 0 failed ✓
- `npm run build` — 1 pre-existing TS error in code-sync.ts (not from our changes), no new errors ✓

## Diagnostics

- Run `npx tsx src/resources/extensions/gsd/tests/docker-backend.test.ts` — prints per-group headers with pass/fail detail
- On failure: `FAIL: <description> — expected <X>, got <Y>` with exact values for immediate diagnosis
- To debug mock behavior: inspect the `captured-args` file in the mock temp dir (path printed if you add a console.log to the test)
- `grep -c 'assert\|assertEq' src/resources/extensions/gsd/tests/docker-backend.test.ts` to count assertions

## Deviations

- 79 assertions (plan estimated 40-60) — more thorough coverage of fallback messages for exit 125/126/127 with empty stderr, and GPU on remote path
- Remote path test uses local bare repo as `repoUrl` (same pattern as ssh-backend.test.ts) — real pushExperimentBranch + runGit calls against local git, only Docker spawn is mocked

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/docker-backend.test.ts` — new: 79-assertion contract test suite with mock docker binary
- `.gsd/milestones/M004/slices/S04/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
