---
id: T01
parent: S05
milestone: M004
provides:
  - validateComputeConfig() in state.ts with parseCampaignConfig integration
  - checkSSHConnectivity() and checkDockerDaemon() pre-flight helpers in compute-backend.ts
  - try/catch error wrapping around backend dispatch in eval-runner.ts runExperimentPostProcess
  - Pre-flight check calls for SSH/Docker before eval loop in runExperimentPostProcess
  - config-integration.test.ts with 55 assertions covering all paths
key_files:
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/compute-backend.ts
  - src/resources/extensions/gsd/eval-runner.ts
  - src/resources/extensions/gsd/tests/config-integration.test.ts
key_decisions:
  - Outer try/catch wraps entire eval block (resolveBackend through return result) rather than only backend.runEval() — catches any unexpected throw in the pipeline
  - Pre-flight checks run after resolveBackend but before eval loop, producing discard results with "Pre-flight failed:" prefix in reason
  - validateComputeConfig is a standalone exported function (not inlined in parseCampaignConfig) for direct testability
patterns_established:
  - Pre-flight check pattern: spawnSync with structured {ok, error?} return, called from orchestrator before compute-intensive work
  - Error wrapping pattern: catch block constructs discard ExperimentResult, calls revertExperiment, calls appendExperimentLog, returns result
observability_surfaces:
  - Pre-flight errors in discard reason with "Pre-flight failed:" prefix
  - Backend errors in discard reason with "backend error:" prefix
  - grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error' state.ts eval-runner.ts compute-backend.ts
duration: 25m
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T01: Validate compute config, wrap backend errors, add pre-flight checks, and prove end-to-end integration

**Added compute config validation in parseCampaignConfig, backend error wrapping with revert+JSONL, SSH/Docker pre-flight checks, and 55-assertion integration test proving the full pipeline.**

## What Happened

Added `validateComputeConfig()` to state.ts — validates SSH (requires host + workDir strings), Docker (requires image string), local (always valid), rejects unknown types and non-objects. Called from `parseCampaignConfig` so malformed compute configs are caught at load time and return null.

Added `checkSSHConnectivity(host)` and `checkDockerDaemon(dockerHost?)` to compute-backend.ts. Both use `spawnSync` with structured `{ ok: boolean; error?: string }` returns — SSH runs `ssh -o BatchMode=yes -o ConnectTimeout=5 host true`, Docker runs `docker info` (with optional `-H` flag).

In eval-runner.ts `runExperimentPostProcess`: wrapped `resolveBackend()` in its own try/catch (returns discard on factory error), added pre-flight check calls for SSH/Docker backends after resolveBackend but before the eval loop, and wrapped the entire eval block (from evalConfig through return result) in a try/catch that produces discard results with revert + JSONL logging on any unexpected throw.

Wrote config-integration.test.ts with 55 assertions across 5 test groups: config validation (10 assertions), parseCampaignConfig integration (8), pre-flight checks with mock binaries (8), error wrapping and missing config paths (10), end-to-end dispatch and full pipeline (19).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — **55 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — **45 passed, 0 failed** (no regression)
- Observability grep confirms all integration points are discoverable

## Diagnostics

- Invalid compute config → `parseCampaignConfig` returns null → existing "missing or invalid campaign config" discard path fires
- Backend factory/eval throw → `backend error: <message>` in discard reason, with revert + JSONL log
- SSH pre-flight failure → `Pre-flight failed: SSH connectivity to <host>: <error>` in discard reason
- Docker pre-flight failure → `Pre-flight failed: Docker daemon[at <host>]: <error>` in discard reason
- Inspect: `grep -n 'validateComputeConfig\|checkSSH\|checkDocker\|backend error' src/resources/extensions/gsd/state.ts src/resources/extensions/gsd/eval-runner.ts src/resources/extensions/gsd/compute-backend.ts`

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/state.ts` — Added `validateComputeConfig()` and call from `parseCampaignConfig`
- `src/resources/extensions/gsd/compute-backend.ts` — Added `checkSSHConnectivity()` and `checkDockerDaemon()` exports
- `src/resources/extensions/gsd/eval-runner.ts` — Added try/catch error wrapping, pre-flight check calls, imported check functions
- `src/resources/extensions/gsd/tests/config-integration.test.ts` — New test file with 55 assertions
