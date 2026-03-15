---
id: S05
parent: M004
milestone: M004
provides:
  - validateComputeConfig() in state.ts with parseCampaignConfig integration
  - checkSSHConnectivity() and checkDockerDaemon() pre-flight helpers in compute-backend.ts
  - try/catch error wrapping around backend dispatch in eval-runner.ts runExperimentPostProcess
  - Pre-flight check calls for SSH/Docker before eval loop in runExperimentPostProcess
  - config-integration.test.ts with 55 assertions covering all paths
requires:
  - slice: S01
    provides: ComputeBackend interface, resolveBackend(), LocalBackend
  - slice: S03
    provides: SSHBackend, SSHBackendConfig
  - slice: S04
    provides: DockerBackend, DockerBackendConfig
affects: []
key_files:
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/config-integration.test.ts
key_decisions:
  - "D073: Compute config validation at parse time — validateComputeConfig() in parseCampaignConfig, invalid config returns null"
  - "D074: Backend error wrapping in eval-runner — try/catch around resolveBackend + eval loop produces discard ExperimentResult"
  - "D075: Pre-flight checks are non-blocking — checkSSH/checkDocker return structured result, never throw"
patterns_established:
  - "Pre-flight check pattern: spawnSync with structured {ok, error?} return, called from orchestrator before compute-intensive work"
  - "Error wrapping pattern: catch block constructs discard ExperimentResult, calls revertExperiment, calls appendExperimentLog, returns result"
observability_surfaces:
  - "Pre-flight errors in discard reason with 'Pre-flight failed:' prefix"
  - "Backend errors in discard reason with 'backend error:' prefix"
  - "grep -n 'validateComputeConfig\\|checkSSH\\|checkDocker\\|backend error' state.ts eval-runner.ts compute-backend.ts"
drill_down_paths:
  - .gsd/milestones/M004/slices/S05/tasks/T01-SUMMARY.md
duration: 25m
verification_result: passed
completed_at: 2026-03-15
---

# S05: Configuration, Credentials & Integration

**Compute config validated at parse time, backend errors wrapped into clean discards, SSH/Docker pre-flight checks surface actionable messages, end-to-end dispatch proven by 55-assertion integration test.**

## What Happened

Added `validateComputeConfig()` to state.ts — validates SSH (requires `host` + `workDir` strings), Docker (requires `image` string), local (always valid), rejects unknown types and non-objects. Called from `parseCampaignConfig()` so invalid compute configs return null at load time, triggering the existing "missing or invalid campaign config" discard path.

Added `checkSSHConnectivity(host)` and `checkDockerDaemon(dockerHost?)` to compute-backend.ts. Both use `spawnSync` with structured `{ ok: boolean; error?: string }` returns. SSH runs `ssh -o BatchMode=yes -o ConnectTimeout=5 host true`. Docker runs `docker info` with optional `-H` flag.

In eval-runner.ts `runExperimentPostProcess`: wrapped `resolveBackend()` in try/catch (returns discard on factory error), added pre-flight check calls for SSH/Docker backends after resolveBackend but before the eval loop, and wrapped the entire eval block in a try/catch that produces discard results with revert + JSONL logging on any unexpected throw.

Wrote config-integration.test.ts with 55 assertions across 5 test groups: config validation (10), parseCampaignConfig integration (8), pre-flight checks with mock binaries (8), error wrapping and missing config paths (10), end-to-end dispatch and full pipeline (19).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — **55 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** (no regression)
- Observability grep confirms all integration points discoverable via `grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error'`

## Requirements Advanced

- R031 (Backend Configuration) — compute field validated at parse time with backend-specific required fields
- R033 (Credential Management) — pre-flight checks via existing OS mechanisms (ssh-agent, Docker config), structured error returns
- R034 (Backend Failure Handling) — try/catch wrapping produces discard with revert + JSONL, no unhandled exceptions
- R035 (Eval Timeout Forwarding) — timeout forwarding proven via end-to-end dispatch test (config → resolveBackend → backend.runEval with timeout)

## Requirements Validated

- R031 — parseCampaignConfig rejects SSH without host/workDir, Docker without image, unknown types. 18 config validation assertions.
- R033 — checkSSHConnectivity and checkDockerDaemon use OS-native ssh/docker binaries. Mock binary tests prove structured error returns. Pre-flight failures produce actionable discard messages.
- R034 — Backend throw → discard ExperimentResult with revert + JSONL logging. Missing config → null → existing discard path. 10 error wrapping assertions.
- R035 — End-to-end dispatch test proves timeout flows from config through resolveBackend to backend.runEval. SSH/Docker backends (proven in S03/S04) forward timeout to subprocess. 19 end-to-end assertions.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Pre-flight checks use `spawnSync` with short timeouts — very slow networks may produce false negatives (pre-flight fails but actual SSH would succeed). Pre-flight failures produce discard, not retry.
- No runtime credential rotation — if SSH keys or Docker auth expire mid-campaign, the backend errors surface as discards rather than prompting for re-auth.

## Follow-ups

- none — this is the terminal slice for M004

## Files Created/Modified

- `src/resources/extensions/gsd/state.ts` — Added `validateComputeConfig()` and call from `parseCampaignConfig`
- `src/resources/extensions/gsd/compute-backend.ts` — Added `checkSSHConnectivity()` and `checkDockerDaemon()` exports
- `src/resources/extensions/gsd/eval-runner.ts` — Added try/catch error wrapping, pre-flight check calls, imported check functions
- `src/resources/extensions/gsd/tests/config-integration.test.ts` — New test file with 55 assertions

## Forward Intelligence

### What the next slice should know
- M004 is complete. All 9 requirements (R027–R035) validated. The compute backend abstraction is fully wired.

### What's fragile
- Pre-flight checks shell out to `ssh` and `docker` binaries — if those are absent from PATH, the pre-flight itself fails silently (returns `{ ok: false, error }`) and produces a discard. This is by design (D075) but could confuse users who expect a more specific "binary not found" message.

### Authoritative diagnostics
- `grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error' src/resources/extensions/gsd/state.ts src/resources/extensions/gsd/eval-runner.ts src/resources/extensions/gsd/compute-backend.ts` — shows all integration points
- Discard reasons always contain structured prefixes: `Pre-flight failed:` or `backend error:`

### What assumptions changed
- none — all assumptions from the slice plan held
