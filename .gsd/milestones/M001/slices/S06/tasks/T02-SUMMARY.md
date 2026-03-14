---
id: T02
parent: S06
milestone: M001
provides:
  - MLOps client lifecycle wired into auto.ts (init at startAuto, log at handleAgentEnd, finish at stopAuto)
  - CampaignConfig.mlops optional field for platform selection
key_files:
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/state.ts
key_decisions:
  - MLOps init placed after self-heal and secrets collection in startAuto, before first dispatch — ensures credentials are available
  - logExperiment call placed inside the runExperimentPostProcess try block (after UI notify, before catch) so it has access to result and experimentNumber variables
  - Module-level mlopsClient variable matches the pattern used by other module-level state in auto.ts (active, paused, etc.)
patterns_established:
  - Non-fatal MLOps hooks via try/catch at all three lifecycle points — consistent with T01's non-fatal contract
observability_surfaces:
  - ctx.ui.notify at startAuto when MLOps client initializes ("MLOps: logging to <platform> dashboard")
  - mlopsClient.getDashboardUrl() returns platform URL when initialized (for S07 morning report)
  - Circuit breaker state queryable via mlopsClient.circuitBreaker.state when client is active
duration: 15m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Wire MLOps into campaign lifecycle and extend CampaignConfig

**Wired MLOps client into auto.ts campaign lifecycle at three points (start, per-experiment, stop) and extended CampaignConfig with optional mlops field.**

## What Happened

Added `mlops?` optional field to `CampaignConfig` in types.ts with platform, project, entity, and trackingUri properties. Updated `parseCampaignConfig()` comment in state.ts to document the optional field pass-through (no validation change needed — `as CampaignConfig` cast handles it).

In auto.ts, added import for `createMLOpsClient` and `MLOpsClient`, plus a module-level `mlopsClient` variable. Wired three lifecycle hooks:

1. **startAuto**: After self-heal and before first dispatch, reads campaign config from the active slice. If `campaign.mlops` is present, creates and initializes the client, emitting a UI notification.
2. **handleAgentEnd**: Inside the `run-experiment` block, after `runExperimentPostProcess` returns and the UI notification is shown, logs the experiment result via `mlopsClient.logExperiment()`.
3. **stopAuto**: Before resetting state, calls `mlopsClient?.finish()` and nulls the reference.

All three hooks are wrapped in non-fatal try/catch blocks — MLOps failures never block auto-mode or experiments.

## Verification

- `npm run build` — exits 0, no type errors
- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — 105/105 pass
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 73/73 pass (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — 33/33 pass
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — 113/113 pass

## Diagnostics

- `mlopsClient` module-level variable in auto.ts: non-null when active campaign has mlops config and credentials are available
- `mlopsClient.getDashboardUrl()` → platform URL string (MLFlow or W&B) for external inspection
- `mlopsClient.circuitBreaker.state` → `{ isOpen, failureCount, lastError, openedAt }` for failure tracking
- `[labrat:mlops]` console logs at creation time from the factory (T01)

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — Added optional `mlops` field to CampaignConfig interface
- `src/resources/extensions/gsd/state.ts` — Updated parseCampaignConfig comment documenting optional field pass-through
- `src/resources/extensions/gsd/auto.ts` — Added MLOps import, module-level client state, and three lifecycle hooks (startAuto/handleAgentEnd/stopAuto)
- `.gsd/milestones/M001/slices/S06/tasks/T02-PLAN.md` — Added Observability Impact section
