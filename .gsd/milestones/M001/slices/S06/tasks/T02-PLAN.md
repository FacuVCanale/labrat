---
estimated_steps: 5
estimated_files: 3
---

# T02: Wire MLOps into campaign lifecycle and extend CampaignConfig

**Slice:** S06 — Live MLOps Integration
**Milestone:** M001

## Description

Connect the MLOps client module (T01) into the experiment loop lifecycle. Extend `CampaignConfig` with an optional `mlops` field, update `parseCampaignConfig()` to validate it, and wire the client into `startAuto`/`handleAgentEnd`/`stopAuto` in auto.ts. All hooks are non-fatal.

## Steps

1. Add `mlops?` optional field to `CampaignConfig` in `types.ts`:
   ```typescript
   mlops?: {
     platform: 'wandb' | 'mlflow';
     project?: string;
     entity?: string;
     trackingUri?: string;
   };
   ```
   This is optional — existing CampaignConfig objects without it remain valid.

2. Update `parseCampaignConfig()` in `state.ts`: the existing shape validation checks required fields. The `mlops` field is optional, so no validation gate needed — just let it pass through with the `as CampaignConfig` cast. Add a comment noting the optional field.

3. In `auto.ts`, add module-level state and import:
   - `import { createMLOpsClient, type MLOpsClient } from "./mlops-integration.js";`
   - `let mlopsClient: MLOpsClient | null = null;`
   - In `startAuto`, after the campaign config detection block (around line 437 where crash recovery checks for `run-experiment`), add:
     ```typescript
     try {
       const campaign = parseCampaignConfig(sliceDir);
       if (campaign) {
         mlopsClient = createMLOpsClient(campaign.mlops);
         if (mlopsClient) {
           await mlopsClient.init({
             name: campaign.name,
             researchQuestion: campaign.researchQuestion,
             targetFiles: campaign.targetFiles,
             evalCommand: campaign.evalConfig.command,
           });
           ctx.ui.notify(`MLOps: logging to ${campaign.mlops?.platform} dashboard`, "info");
         }
       }
     } catch { /* non-fatal */ }
     ```

4. In `handleAgentEnd`, inside the `run-experiment` block, after `runExperimentPostProcess` returns `result` and the UI notification (around line 606), add:
   ```typescript
   try {
     if (mlopsClient) {
       await mlopsClient.logExperiment(result, experimentNumber);
     }
   } catch { /* non-fatal — MLOps logging must never block experiments */ }
   ```

5. In `stopAuto`, before resetting state, add:
   ```typescript
   try {
     await mlopsClient?.finish();
   } catch { /* non-fatal */ }
   mlopsClient = null;
   ```

## Must-Haves

- [ ] CampaignConfig.mlops optional field in types.ts
- [ ] parseCampaignConfig passes through optional mlops field without breaking existing validation
- [ ] auto.ts imports and stores module-level MLOps client
- [ ] startAuto creates and initializes MLOps client when campaign has mlops config
- [ ] handleAgentEnd logs experiment result to MLOps after eval post-processing
- [ ] stopAuto finishes and clears MLOps client
- [ ] All MLOps hooks wrapped in non-fatal try/catch

## Verification

- `npm run build` — exits 0, no type errors
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 66/66 pass (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — existing tests pass
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — existing tests pass
- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — still passes

## Inputs

- `src/resources/extensions/gsd/mlops-integration.ts` — T01's client module with `createMLOpsClient`, `MLOpsClient` interface
- `src/resources/extensions/gsd/types.ts` — current `CampaignConfig` interface
- `src/resources/extensions/gsd/state.ts` — current `parseCampaignConfig()` function
- `src/resources/extensions/gsd/auto.ts` — current `startAuto`, `handleAgentEnd`, `stopAuto` functions
- S03 summary — `runExperimentPostProcess` returns `ExperimentResult`, hook is at line 594

## Observability Impact

- **New runtime signal:** `ctx.ui.notify("MLOps: logging to <platform> dashboard", "info")` emitted once in `startAuto` when a campaign with `mlops` config is detected and the client initializes successfully. Silent skip when credentials are missing (handled by factory).
- **Per-experiment logging:** `mlopsClient.logExperiment()` called after each `runExperimentPostProcess` — failures are swallowed (non-fatal try/catch), visible only through the circuit breaker state on the client.
- **Shutdown finalization:** `mlopsClient.finish()` called in `stopAuto` before state reset. Failure is non-fatal.
- **Inspection surface:** Module-level `mlopsClient` variable. When non-null, `mlopsClient.getDashboardUrl()` returns the platform URL (consumed by morning report in S07). Circuit breaker state queryable via `mlopsClient.circuitBreaker?.state`.
- **Failure visibility:** Circuit breaker on the underlying client tracks consecutive failures and opens after 5. When open, all `logExperiment` calls throw immediately with `"Circuit breaker open: <lastError>"` — caught by the non-fatal wrapper in `handleAgentEnd`.

## Expected Output

- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` with optional `mlops` field
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()` unchanged behavior for existing configs, accepts new mlops field
- `src/resources/extensions/gsd/auto.ts` — MLOps client lifecycle wired at three points (start, per-experiment, stop)
