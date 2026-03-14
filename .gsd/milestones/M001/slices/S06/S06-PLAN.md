# S06: Live MLOps Integration

**Goal:** Experiment metrics and orchestration metadata log to W&B/MLFlow in real-time while the loop runs, via a non-fatal integration layer.
**Demo:** Contract tests prove correct HTTP request shapes for both MLFlow REST and W&B GraphQL/filestream APIs. Build passes with the integration wired into auto.ts campaign lifecycle. Missing credentials silently skip. Platform failures never block experiments.

## Must-Haves

- `MLOpsClient` interface with `init()`, `logExperiment()`, `finish()` lifecycle
- `MLFlowClient` using documented REST API (create experiment, create run, log-batch metrics, update run status)
- `WandbClient` using GraphQL `upsertBucket` + filestream endpoint (run creation, metric logging, run finish)
- `createMLOpsClient()` factory that reads `CampaignConfig.mlops` + env vars, returns client or null
- Circuit breaker: after N consecutive failures, stop attempting for M minutes
- Metric name sanitization for W&B's `/^[_a-zA-Z][_a-zA-Z0-9]*$/` constraint
- Dashboard URL resolver for both platforms
- `CampaignConfig.mlops` optional config field with validation in `parseCampaignConfig()`
- Wiring in auto.ts: create client at campaign start, log per experiment in `handleAgentEnd`, finish on `stopAuto`
- All MLOps calls non-fatal — failure never blocks experiment dispatch or crashes the loop
- Missing env vars (`WANDB_API_KEY`, `MLFLOW_TRACKING_URI`) = silent skip with one-time log at campaign start
- Contract tests proving request shapes, auth headers, error handling, circuit breaker, sanitization

## Proof Level

- This slice proves: contract (HTTP request shapes, auth, error handling, circuit breaker logic via mocked fetch)
- Real runtime required: no (would need live W&B/MLFlow servers — contract tests with mocked fetch are sufficient)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — all assertions pass
- `npm run build` — exits 0, no type errors
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — 66/66 pass (no regressions)
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — existing tests pass (CampaignConfig changes backward-compatible)

## Observability / Diagnostics

- Runtime signals: one-time log at campaign start indicating MLOps platform detected (or skipped), circuit breaker open/close transitions, per-experiment log success/failure
- Inspection surfaces: `MLOpsClient.getDashboardUrl()` returns platform URL for morning report (S07), circuit breaker state queryable
- Failure visibility: circuit breaker tracks consecutive failure count and last error message; `logExperiment` failures surface via `ctx.ui.notify` in auto.ts
- Redaction constraints: `WANDB_API_KEY` must never appear in logs or error messages

## Integration Closure

- Upstream surfaces consumed: `ExperimentResult` from `eval-runner.ts` (metrics, decision, timing, cost), `CampaignConfig` from `types.ts`/`state.ts`, module-level state pattern from `auto.ts`
- New wiring introduced: MLOps client lifecycle in `startAuto`/`handleAgentEnd`/`stopAuto`, `mlops?` field on `CampaignConfig`
- What remains before the milestone is truly usable end-to-end: S07 (CLI, morning report with dashboard link, Karpathy smoke test)

## Tasks

- [x] **T01: Build MLOps client module with contract tests** `est:45m`
  - Why: Core module — the entire integration layer lives here. Independently testable without auto.ts wiring.
  - Files: `src/resources/extensions/gsd/mlops-integration.ts`, `src/resources/extensions/gsd/tests/mlops-integration.test.ts`
  - Do: Create `MLOpsClient` interface. Implement `MLFlowClient` (REST: create experiment with RESOURCE_ALREADY_EXISTS fallback, create run, log-batch, update run). Implement `WandbClient` (GraphQL upsertBucket, filestream POST, auth via base64 `api:<key>`). Build `createMLOpsClient()` factory reading config + env. Add circuit breaker (5 consecutive failures → 5 min backoff). Add metric name sanitizer for W&B. Add dashboard URL resolver. Write contract tests with mocked global `fetch` covering: MLFlow full lifecycle, W&B full lifecycle, auth headers, metric sanitization, circuit breaker open/close, missing credentials → null client, non-fatal error handling.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` passes, `npm run build` exits 0
  - Done when: Both clients pass contract tests proving correct HTTP request shapes, auth, error paths, and circuit breaker behavior

- [x] **T02: Wire MLOps into campaign lifecycle and extend CampaignConfig** `est:25m`
  - Why: The module from T01 is inert until wired into the experiment loop. This task connects it.
  - Files: `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/state.ts`, `src/resources/extensions/gsd/auto.ts`
  - Do: Add `mlops?` optional field to `CampaignConfig` in types.ts. Update `parseCampaignConfig()` shape validation in state.ts to pass through optional mlops field (don't reject configs without it). In auto.ts: add module-level `let mlopsClient: MLOpsClient | null = null`. In `startAuto`, after campaign detection, call `createMLOpsClient()` and store result. In `handleAgentEnd` run-experiment block, after `runExperimentPostProcess`, call `logExperiment()` in try/catch. In `stopAuto`, call `client?.finish()`. All non-fatal. Verify existing tests still pass.
  - Verify: `npm run build` exits 0, existing test suites pass (`eval-runner`, `research-types`, `derive-state`)
  - Done when: Build passes, CampaignConfig accepts optional mlops field, auto.ts has MLOps hooks at all three lifecycle points

## Files Likely Touched

- `src/resources/extensions/gsd/mlops-integration.ts` (new)
- `src/resources/extensions/gsd/tests/mlops-integration.test.ts` (new)
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/state.ts`
- `src/resources/extensions/gsd/auto.ts`
