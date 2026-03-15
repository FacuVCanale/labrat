# S05: Configuration, Credentials & Integration

**Goal:** CampaignConfig.compute field fully validated at parse time, backend errors wrapped into proper discard results, credential pre-flight checks surface actionable messages, and end-to-end dispatch proven by integration test.

**Demo:** A config with `{ type: 'ssh' }` but no `host` is rejected at parse time (returns null). A backend that throws during `runEval()` produces a clean discard result with revert and JSONL logging. Pre-flight SSH/Docker checks return structured errors. Integration test proves config → resolveBackend → backend.runEval → result pipeline.

## Must-Haves

- `parseCampaignConfig()` validates `compute` field: SSH requires `host` + `workDir`, Docker requires `image`, unknown type returns null
- `resolveBackend()` + `backend.runEval()` call site in `runExperimentPostProcess` wrapped in try/catch that produces discard ExperimentResult with revert + JSONL log
- `checkSSHConnectivity(host)` pre-flight returns structured `{ ok, error? }` via `ssh -o BatchMode=yes host true`
- `checkDockerDaemon(dockerHost?)` pre-flight returns structured `{ ok, error? }` via `docker info` / `docker -H host info`
- Pre-flight failures produce RunEvalResult (not thrown), called before eval loop in runExperimentPostProcess for remote backends
- Integration test proves: valid SSH config parses → resolveBackend returns SSHBackend; valid Docker config parses → DockerBackend; invalid config → null; backend error → discard with revert

## Proof Level

- This slice proves: final-assembly
- Real runtime required: no (contract tests with mock binaries, same pattern as S03/S04)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — all assertions pass
- Test covers: compute config validation (SSH/Docker/local/invalid), error wrapping (backend throw → discard), pre-flight checks (SSH/Docker mock binaries), end-to-end dispatch (config → backend → result)

## Observability / Diagnostics

- Runtime signals: Pre-flight check errors surfaced in RunEvalResult.stderr with "Pre-flight failed:" prefix
- Inspection surfaces: `grep -n 'validateComputeConfig\|checkSSH\|checkDocker' eval-runner.ts` shows all new integration points
- Failure visibility: Invalid compute config → parseCampaignConfig returns null → existing "missing or invalid campaign config" discard path fires; backend throw → new catch produces discard with error in reason field
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: ComputeBackend/resolveBackend (S01), SSHBackend/SSHBackendConfig (S03), DockerBackend/DockerBackendConfig (S04), pushExperimentBranch (S02)
- New wiring introduced in this slice: compute config validation in parseCampaignConfig, try/catch error wrapping around backend dispatch in runExperimentPostProcess, pre-flight check calls before eval loop
- What remains before the milestone is truly usable end-to-end: nothing — this is the terminal slice

## Tasks

- [x] **T01: Validate compute config, wrap backend errors, add pre-flight checks, and prove end-to-end integration** `est:45m`
  - Why: Closes all four remaining active requirements (R031/R033/R034/R035) in one pass — config validation, error containment, credential checks, and integration proof are tightly coupled and touch the same call sites
  - Files: `src/resources/extensions/gsd/state.ts`, `src/resources/extensions/gsd/eval-runner.ts`, `src/resources/extensions/gsd/compute-backend.ts`, `src/resources/extensions/gsd/tests/config-integration.test.ts`
  - Do: (1) Add `validateComputeConfig()` in state.ts after existing shape validation in parseCampaignConfig — SSH requires host+workDir strings, Docker requires image string, unknown type returns null. (2) Add `checkSSHConnectivity` and `checkDockerDaemon` helpers in compute-backend.ts — spawnSync pre-flight returning `{ ok, error? }`. (3) In eval-runner.ts runExperimentPostProcess: wrap resolveBackend + eval loop in try/catch producing discard result with revert+JSONL; call pre-flight for SSH/Docker before eval loop, return discard on failure. (4) Write config-integration.test.ts with contract tests covering all paths.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/config-integration.test.ts` — all pass; `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 pass, no regression
  - Done when: All tests pass, invalid compute configs rejected at parse time, backend errors produce clean discards, pre-flight checks return structured results

## Files Likely Touched

- `src/resources/extensions/gsd/state.ts`
- `src/resources/extensions/gsd/eval-runner.ts`
- `src/resources/extensions/gsd/compute-backend.ts`
- `src/resources/extensions/gsd/tests/config-integration.test.ts`
