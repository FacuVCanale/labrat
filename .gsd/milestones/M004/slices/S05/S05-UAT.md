# S05: Configuration, Credentials & Integration — UAT

**Milestone:** M004
**Written:** 2026-03-15

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All behavior is proven via contract tests with mock binaries. No live SSH/Docker runtime needed — the integration points are spawnSync calls with structured returns, same pattern validated in S03/S04.

## Preconditions

- Repository checked out at the S05 branch
- Node.js and `npx tsx` available
- No SSH or Docker runtime required (mock binaries used)

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — all 55 assertions pass. This confirms config validation, pre-flight checks, error wrapping, and end-to-end dispatch are wired correctly.

## Test Cases

### 1. SSH config validation at parse time

1. Create a CAMPAIGN.json with `"compute": { "type": "ssh", "host": "gpu-box.local", "workDir": "/tmp/eval" }`
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns a valid CampaignConfig with compute field intact

4. Modify to `"compute": { "type": "ssh" }` (missing host and workDir)
5. Call `parseCampaignConfig()` on it
6. **Expected:** Returns null — config rejected at parse time

7. Modify to `"compute": { "type": "ssh", "host": "gpu-box.local" }` (missing workDir only)
8. Call `parseCampaignConfig()` on it
9. **Expected:** Returns null — SSH requires both host and workDir

### 2. Docker config validation at parse time

1. Create a CAMPAIGN.json with `"compute": { "type": "docker", "image": "python:3.11" }`
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns a valid CampaignConfig with compute field intact

4. Modify to `"compute": { "type": "docker" }` (missing image)
5. Call `parseCampaignConfig()` on it
6. **Expected:** Returns null — Docker requires image

### 3. Local and absent compute config (backward compatibility)

1. Create a CAMPAIGN.json with no `compute` field at all
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns a valid CampaignConfig — absent compute means local backend

4. Create a CAMPAIGN.json with `"compute": { "type": "local" }`
5. Call `parseCampaignConfig()` on it
6. **Expected:** Returns a valid CampaignConfig — explicit local is valid

### 4. Unknown compute type rejection

1. Create a CAMPAIGN.json with `"compute": { "type": "modal" }`
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns null — unknown backend type rejected

### 5. Pre-flight SSH connectivity check

1. Call `checkSSHConnectivity("reachable-host")` where ssh binary succeeds (exit 0)
2. **Expected:** Returns `{ ok: true }`

3. Call `checkSSHConnectivity("unreachable-host")` where ssh binary fails (exit 255)
4. **Expected:** Returns `{ ok: false, error: "..." }` with stderr content

### 6. Pre-flight Docker daemon check

1. Call `checkDockerDaemon()` where docker binary succeeds (exit 0)
2. **Expected:** Returns `{ ok: true }`

3. Call `checkDockerDaemon()` where docker binary fails (exit 1)
4. **Expected:** Returns `{ ok: false, error: "..." }` with stderr content

5. Call `checkDockerDaemon("tcp://remote:2375")` — verify `-H tcp://remote:2375` flag passed to docker binary
6. **Expected:** Returns structured result with correct host flag

### 7. Backend error wrapping produces discard

1. Configure a campaign with a backend whose `runEval()` throws an error
2. Call `runExperimentPostProcess()` with that config
3. **Expected:** Returns discard ExperimentResult with `decision: "discard"`, reason containing `"backend error: <message>"`, revert executed, JSONL entry appended

### 8. Pre-flight failure produces discard before eval

1. Configure a campaign with SSH backend where `checkSSHConnectivity` returns `{ ok: false, error: "Connection refused" }`
2. Call `runExperimentPostProcess()` with that config
3. **Expected:** Returns discard ExperimentResult with reason containing `"Pre-flight failed: SSH connectivity"`, eval never runs

### 9. End-to-end dispatch: config → backend → result

1. Parse a config with `compute: { type: "local" }` via `parseCampaignConfig()`
2. Call `resolveBackend(config.compute)` — verify returns LocalBackend instance
3. Call `backend.runEval({ command: "echo ok", timeoutSecs: 10, cwd: "/tmp" })`
4. **Expected:** Returns RunEvalResult with stdout containing "ok", exitCode 0

## Edge Cases

### Non-object compute field

1. Create a CAMPAIGN.json with `"compute": "ssh"`
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns null — compute must be an object with a type field

### Pre-flight check binary not on PATH

1. Call `checkSSHConnectivity("host")` when `ssh` binary is not on PATH
2. **Expected:** Returns `{ ok: false, error: "..." }` — spawnSync ENOENT produces structured error, no thrown exception

### Compute config with extra fields

1. Create SSH config with extra fields: `{ "type": "ssh", "host": "h", "workDir": "/w", "controlPath": "/tmp/ssh" }`
2. Call `parseCampaignConfig()` on it
3. **Expected:** Returns valid CampaignConfig — extra SSH-specific fields are allowed, only required fields are validated

## Failure Signals

- `parseCampaignConfig()` returns a non-null config for invalid compute (e.g., SSH without host) — validation gap
- `runExperimentPostProcess()` throws an unhandled exception when backend errors — missing try/catch
- Pre-flight check throws instead of returning structured result — violates D075
- Discard reason missing structured prefix (`Pre-flight failed:` or `backend error:`) — actionable message contract broken

## Requirements Proved By This UAT

- R031 — Config validation: SSH requires host+workDir, Docker requires image, absent=local, unknown=rejected
- R033 — Credential management: pre-flight checks use OS-native ssh/docker, structured error returns
- R034 — Backend failure handling: errors produce discard with revert+JSONL, never crash orchestrator
- R035 — Timeout forwarding: end-to-end dispatch proves timeout flows through config → backend → subprocess

## Not Proven By This UAT

- Live SSH connection to a real remote host (proven by S03's localhost SSH contract tests)
- Live Docker container execution (proven by S04's mock docker binary tests)
- Multi-backend campaigns (out of scope per R041)
- Credential rotation during long-running campaigns (known limitation)

## Notes for Tester

- All test cases can be verified by running `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` which covers every case above via contract tests with mock binaries.
- The pre-flight checks use real `spawnSync` calls but the test harness prepends mock shell scripts to PATH, so no actual SSH or Docker connections are made.
- The error wrapping test group uses a monkey-patched `resolveBackend` that returns a backend whose `runEval()` throws, simulating real backend failures.
