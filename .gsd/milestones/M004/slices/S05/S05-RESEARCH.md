# S05: Configuration, Credentials & Integration — Research

**Date:** 2026-03-15

## Summary

S05 is the terminal integration slice for M004. The three backend implementations (Local, SSH, Docker) are complete and factory-routed, but the config parsing has a significant validation gap: `parseCampaignConfig()` in state.ts does zero validation of the `compute` field — it casts raw JSON to `CampaignConfig` after checking only the five required top-level fields. A config like `{ type: 'ssh' }` without `host` or `workDir` passes parsing and blows up at runtime inside SSHBackend.runEval().

The second gap is error containment. `resolveBackend()` at eval-runner.ts:555 is not wrapped in try/catch. If it throws (unsupported type, constructor error) or if `backend.runEval()` throws unexpectedly, the experiment commit is orphaned — auto.ts:647 catches the error and notifies but doesn't revert the commit, doesn't log to EXPERIMENT-LOG.jsonl, and doesn't create a discard result. This violates R034 (graceful degradation) and R007 (crash recovery).

The third gap is credential pre-flight. Neither SSHBackend nor DockerBackend check whether their prerequisites exist before attempting eval. SSH connection failure (exit 255) is already handled via exit code mapping, and Docker daemon error (exit 125) similarly — but these only fire after the expensive push + spawn cycle. Pre-flight checks (`ssh -o BatchMode=yes host true` and `docker info`) would surface errors immediately with actionable messages, satisfying R033.

## Recommendation

Three-layer approach, all within the existing module boundaries:

1. **Config validation in parseCampaignConfig** — Add `validateComputeConfig()` that checks backend-specific required fields after the existing shape validation. Invalid compute config returns null (same pattern as malformed campaign). This is the cheapest change with the most value — catches typos/missing fields at config load time, before any eval attempt.

2. **Error wrapping in runExperimentPostProcess** — Wrap the `resolveBackend()` + `backend.runEval()` call site in try/catch that produces a proper discard result with revert and JSONL logging. This ensures backend failures are indistinguishable from eval failures to the rest of the pipeline. Same pattern as the existing "missing campaign config" early-return at line 534.

3. **Pre-flight credential checks** — `checkSSHConnectivity(host)` and `checkDockerDaemon(dockerHost?)` as lightweight helpers called from `runExperimentPostProcess` before the eval loop. Failures return structured RunEvalResult (not thrown). Non-fatal — if the pre-flight itself errors, skip it and let the actual eval attempt surface the problem.

This is low-risk work. All three layers are additive — no existing behavior changes. The integration test is the verification proof that the full config → backend → eval → result chain works.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Config shape validation | parseCampaignConfig's existing pattern: check fields, return null on bad shape | Consistent with how all other config fields are validated — no new error-reporting mechanism needed |
| Backend error → discard | eval-runner.ts:534–551 "missing campaign config" early-return pattern | Same ExperimentResult construction + revertExperiment + appendExperimentLog — proven pattern |
| Credential check pattern | mlops-integration.ts:464–492 `createMLOpsClient()` returns null when credentials missing | Pre-flight check at creation time with null return, not thrown exceptions |
| Exit code mapping | SSHBackend.mapSSHResult / DockerBackend.mapDockerResult | Already handle all runtime failure modes — pre-flight just catches them earlier |

## Existing Code and Patterns

- `src/resources/extensions/gsd/state.ts:77` — `parseCampaignConfig()` reads CAMPAIGN.json, validates 5 required fields, returns null on bad shape or missing file. **This is the insertion point for compute validation.** Current validation is lines 86–94, all `typeof` checks. Compute validation goes after line 94, before the `return parsed as CampaignConfig` at line 95.
- `src/resources/extensions/gsd/compute-backend.ts:72` — `resolveBackend()` factory maps config → backend instance. Exhaustiveness guard at line 86 throws for unknown types. **No changes needed here** — validation happens upstream in parseCampaignConfig.
- `src/resources/extensions/gsd/eval-runner.ts:554–555` — `resolveBackend(config.compute)` call site in `runExperimentPostProcess`. **Wrap this + the eval loop (lines 555–624) in try/catch** that produces a discard result on unexpected errors.
- `src/resources/extensions/gsd/types.ts:305–308` — `ComputeConfig` discriminated union with Local, SSH, Docker variants. All backend-specific fields already defined here. Validation checks these exact field types.
- `src/resources/extensions/gsd/auto.ts:621–650` — Outer try/catch for experiment post-processing. Currently only notifies on error — does not revert or log. **No changes needed in auto.ts** if eval-runner.ts handles errors properly.
- `src/resources/extensions/gsd/ssh-backend.ts:48–52` — SSHBackend constructor assigns host/workDir/controlPath. No validation — trusts input.
- `src/resources/extensions/gsd/docker-backend.ts:48–50` — DockerBackend constructor stores config object. No validation — trusts input.
- `src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45-assertion test suite. Pattern: assert/assertEq helpers, console.log test group headers, tmpDir with cleanup, pass/fail counter with process.exit(1).
- `src/resources/extensions/gsd/tests/research-types.test.ts:301–322` — Existing parseCampaignConfig edge case tests. **Extend these** with compute config validation tests, or create separate test file.

## Constraints

- **parseCampaignConfig returns `CampaignConfig | null`** — invalid compute config must cause null return (not throw). Same behavior as missing/malformed required fields. Callers already handle null.
- **RunEvalResult interface cannot change** (D064, S01 forward intel). Backend errors must fit the existing shape.
- **Backend dispatch is synchronous** — pre-flight checks must also be synchronous (spawnSync).
- **Pre-existing build error in code-sync.ts** — uses `.ts` extension in imports. Not an S05 concern but exists.
- **auto.ts line 627** already catches errors from runExperimentPostProcess as non-fatal. But it doesn't revert or log the experiment. The fix belongs in eval-runner.ts, not auto.ts, so all callers benefit.
- **resolveBackend() is called once per experiment** (not once per campaign). Pre-flight checks that happen inside the eval loop would fire every experiment. If they're expensive (SSH connection test), consider caching or running only on first experiment.

## Common Pitfalls

- **Validating too eagerly** — Don't reject configs that have extra fields or optional fields set to undefined. The `as CampaignConfig` cast pattern means JSON objects can have extra properties. Only validate presence and type of required fields per backend type.
- **Pre-flight hiding real errors** — If `checkSSHConnectivity` fails, it should return a descriptive error, not a generic "SSH not available". The actual SSH stderr (e.g., "Permission denied (publickey)") is more useful than a custom message.
- **Test isolation for pre-flight checks** — Real SSH/Docker pre-flight tests would need localhost SSH or a Docker daemon. Use the mock binary pattern (D072) from docker-backend.test.ts for Docker, and conditional skip for SSH (same pattern as ssh-backend.test.ts).
- **parseCampaignConfig null vs error messages** — Returns null for all failure modes. No way to distinguish "file missing" from "compute config invalid." This is the existing contract — don't change it. The error specificity comes from stderr messages in the RunEvalResult when eval actually fails.

## Open Risks

- **Pre-flight check latency** — `ssh host true` takes ~1s on LAN, ~5s on high-latency networks. Running this before every experiment adds up. Could be mitigated by running only on first experiment per campaign (cache the result in a closure or module-level variable). Low risk — can be addressed later if measured.
- **Docker daemon check on remote host** — `docker -H host info` requires network access to the remote Docker daemon. If the daemon is behind a firewall/VPN, the pre-flight might timeout. Same mitigation: skip pre-flight on error, let the actual eval attempt surface the problem.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript / Node.js child_process | n/a (native API, no skill needed) | none found |
| SSH | n/a (native binary, no library) | none found |
| Docker | n/a (native binary, no library) | none found |

## Sources

- Codebase exploration: parseCampaignConfig (state.ts:77–99), resolveBackend (compute-backend.ts:72–88), runExperimentPostProcess (eval-runner.ts:519–684)
- S01–S04 summaries: established patterns for exit code mapping, mock binary testing, error-to-RunEvalResult conversion
- DECISIONS.md: D062–D072 for architectural constraints on backend design
