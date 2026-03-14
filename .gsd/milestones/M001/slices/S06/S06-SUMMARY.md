---
id: S06
parent: M001
milestone: M001
provides:
  - MLOpsClient interface with init/logExperiment/finish/getDashboardUrl lifecycle
  - MLFlowClient REST implementation (experiments, runs, log-batch, tags, status)
  - WandbClient GraphQL/filestream implementation (upsertBucket, file_stream POST)
  - createMLOpsClient factory with config + env var resolution, returns client or null
  - CircuitBreaker utility (5 consecutive failures → 5 min backoff, half-open recovery)
  - sanitizeMetricName for W&B metric name constraints
  - Dashboard URL resolver for both platforms
  - CampaignConfig.mlops optional field for platform selection
  - MLOps client lifecycle wired into auto.ts (init at startAuto, log at handleAgentEnd, finish at stopAuto)
requires:
  - slice: S03
    provides: ExperimentResult with metrics, decision, timing, cost data
affects:
  - S07
key_files:
  - src/resources/extensions/gsd/mlops-integration.ts
  - src/resources/extensions/gsd/tests/mlops-integration.test.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/auto.ts
key_decisions:
  - Circuit breaker injected via constructor with injectable nowFn for deterministic time-based testing
  - W&B auth uses Buffer.from base64 encoding of "api:<key>" pattern, matching SDK wire protocol
  - All MLOps calls non-fatal — logExperiment catch blocks swallow errors, circuit breaker tracks silently
  - Factory returns null for missing credentials with console.log, never throws
  - MLOps init placed after self-heal/secrets in startAuto, before first dispatch
  - Module-level mlopsClient variable matches existing auto.ts state pattern
patterns_established:
  - Contract test pattern: mock global.fetch with response queue, capture requests for shape verification
  - Circuit breaker wrapping async calls with consecutive failure tracking and time-based recovery
  - Non-fatal integration hooks via try/catch at all lifecycle points
observability_surfaces:
  - CircuitBreaker.state exposes isOpen, failureCount, lastError, openedAt
  - getDashboardUrl() returns platform-specific URL or null before init
  - Factory logs [labrat:mlops] platform detection status once at creation time
  - ctx.ui.notify at startAuto when MLOps client initializes
  - mlopsClient.circuitBreaker accessible for external state queries
drill_down_paths:
  - .gsd/milestones/M001/slices/S06/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S06/tasks/T02-SUMMARY.md
duration: 30m
verification_result: passed
completed_at: 2026-03-13
---

# S06: Live MLOps Integration

**Non-fatal W&B and MLFlow REST integration with circuit breaker, wired into auto.ts campaign lifecycle at init/log/finish points.**

## What Happened

Built the complete MLOps integration layer in two tasks. T01 created the standalone module (`mlops-integration.ts`) with the `MLOpsClient` interface and two concrete implementations. MLFlowClient hits the 2.0 REST API — experiment creation with RESOURCE_ALREADY_EXISTS fallback, run creation with campaign metadata tags, log-batch for per-experiment metrics, set-tag for decision/ID, and run status update on finish. WandbClient uses the GraphQL upsertBucket mutation for run lifecycle and the filestream POST endpoint for metric logging, with metric names sanitized through `sanitizeMetricName()` to match W&B's identifier constraint.

CircuitBreaker is a standalone utility that opens after 5 consecutive failures, backs off for 5 minutes, then half-opens to probe recovery. Both clients accept an optional breaker via constructor injection, and the breaker accepts an injectable `nowFn` for deterministic testing.

The factory (`createMLOpsClient`) reads platform from `CampaignConfig.mlops`, resolves credentials from config fields + env vars (`MLFLOW_TRACKING_URI`, `WANDB_API_KEY`, `WANDB_BASE_URL`, `WANDB_ENTITY`, `WANDB_PROJECT`), and returns the appropriate client or null. Missing credentials produce a one-time `[labrat:mlops]` console.log and return null — never throw.

T02 wired the module into auto.ts at three lifecycle points: client creation after self-heal in `startAuto`, `logExperiment()` after eval post-processing in `handleAgentEnd`, and `finish()` in `stopAuto`. Added the optional `mlops` field to `CampaignConfig` in types.ts. All hooks are non-fatal try/catch — MLOps failures never block experiments or crash the loop.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — **105/105 passed** ✓
- `npm run build` — exits 0, no type errors ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73/73 passed** (no regressions) ✓
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — **33/33 passed** ✓

## Requirements Advanced

- R011 — Live MLOps Integration: fully implemented and contract-tested

## Requirements Validated

- R011 — W&B and MLFlow REST clients proven by 105 contract tests covering full lifecycle, auth headers, metric sanitization, circuit breaker, error handling, credential resolution, and non-fatal integration

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Contract tests verify HTTP request shapes via mocked fetch — no live W&B/MLFlow server testing. This is by design (slice plan specifies contract-level proof).
- W&B uses undocumented but stable GraphQL upsertBucket and filestream endpoints. These could change in future W&B versions.

## Follow-ups

- S07 will use `getDashboardUrl()` in the morning report to show the platform dashboard link.

## Files Created/Modified

- `src/resources/extensions/gsd/mlops-integration.ts` — new module: MLOpsClient interface, MLFlowClient, WandbClient, CircuitBreaker, sanitizeMetricName, createMLOpsClient factory
- `src/resources/extensions/gsd/tests/mlops-integration.test.ts` — 105 contract tests
- `src/resources/extensions/gsd/types.ts` — added optional `mlops` field to CampaignConfig
- `src/resources/extensions/gsd/state.ts` — updated parseCampaignConfig comment for optional field
- `src/resources/extensions/gsd/auto.ts` — MLOps import, module-level client state, three lifecycle hooks

## Forward Intelligence

### What the next slice should know
- `mlopsClient.getDashboardUrl()` returns the platform URL string (or null) — use this in the morning report for the dashboard link
- `CampaignConfig.mlops` is optional — campaigns without it silently skip all MLOps integration
- The factory reads env vars as fallbacks for config fields, so users can configure via either CAMPAIGN.json or environment

### What's fragile
- W&B's GraphQL endpoint and filestream endpoint are undocumented — if W&B changes their API, the client will need updates. Contract tests will catch shape mismatches.

### Authoritative diagnostics
- `[labrat:mlops]` console logs — shows platform detection at campaign start, trustworthy because they're emitted synchronously by the factory
- `circuitBreaker.state` — `{ isOpen, failureCount, lastError, openedAt }` shows real-time integration health

### What assumptions changed
- None — both platforms' REST APIs worked as documented/expected
