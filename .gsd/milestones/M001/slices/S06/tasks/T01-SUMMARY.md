---
id: T01
parent: S06
milestone: M001
provides:
  - MLOpsClient interface with init/logExperiment/finish/getDashboardUrl
  - MLFlowClient REST implementation (experiments/create, runs/create, log-batch, set-tag, update)
  - WandbClient GraphQL/filestream implementation (upsertBucket, file_stream POST)
  - createMLOpsClient factory with config + env var resolution
  - CircuitBreaker utility (5 failures → 5 min backoff, half-open recovery)
  - sanitizeMetricName for W&B metric name constraints
  - Dashboard URL resolver for both platforms
  - 105 contract tests with mocked global.fetch
key_files:
  - src/resources/extensions/gsd/mlops-integration.ts
  - src/resources/extensions/gsd/tests/mlops-integration.test.ts
key_decisions:
  - CircuitBreaker injected into clients via constructor for testability (injectable nowFn for timeout testing)
  - W&B auth uses Buffer.from base64 encoding of "api:<key>" pattern, matching SDK wire protocol
  - logExperiment catch blocks swallow all errors (non-fatal); circuit breaker tracks failures silently
  - Factory returns null for missing credentials with console.log (one-time message, not warn/error)
patterns_established:
  - Contract test pattern: mock global.fetch with response queue, capture requests for shape verification
  - Circuit breaker wrapping async calls with consecutive failure tracking and time-based recovery
observability_surfaces:
  - CircuitBreaker.state exposes isOpen, failureCount, lastError, openedAt
  - getDashboardUrl() returns platform-specific URL or null before init
  - Factory logs platform detection status once at creation time
duration: 15m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Build MLOps client module with contract tests

**Built complete MLOps integration module with MLFlow REST client, W&B GraphQL/filestream client, circuit breaker, metric sanitizer, factory, and 105 contract tests proving all request shapes.**

## What Happened

Created `mlops-integration.ts` with the full provider interface and two concrete implementations. MLFlowClient hits the documented 2.0 REST API — experiments/create with RESOURCE_ALREADY_EXISTS fallback to get-by-name, runs/create with tags for campaign metadata, runs/log-batch for metrics at each step, runs/set-tag for per-experiment decision and ID, and runs/update with FINISHED status. WandbClient uses the undocumented but stable GraphQL upsertBucket mutation for run creation/finish and the filestream POST endpoint for metric logging, with all metric names sanitized through `sanitizeMetricName()` to match W&B's `/^[_a-zA-Z][_a-zA-Z0-9]*$/` constraint.

CircuitBreaker is a standalone utility class that tracks consecutive failures, opens after a configurable threshold (default 5), and half-opens after a time-based reset (default 5 minutes). It accepts an injectable `nowFn` for deterministic time-based testing. Both clients accept an optional breaker via constructor injection.

The factory (`createMLOpsClient`) reads platform from config, resolves credentials from config fields + env vars (`MLFLOW_TRACKING_URI`, `WANDB_API_KEY`, `WANDB_BASE_URL`, `WANDB_ENTITY`, `WANDB_PROJECT`), and returns the appropriate client or null. Missing credentials produce a one-time console.log and return null — never throw.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — **105/105 passed** ✓
- `npm run build` — exits 0, no type errors ✓
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73/73 passed** (no regressions) ✓
- `npx tsx src/resources/extensions/gsd/tests/research-types.test.ts` — **33/33 passed** ✓

## Diagnostics

- `CircuitBreaker.state` → `{ isOpen, failureCount, lastError, openedAt }` for runtime inspection
- `client.getDashboardUrl()` → platform URL string or null (usable in morning report S07)
- `client.circuitBreaker` accessor on both MLFlowClient and WandbClient for external state queries
- Factory logs `[labrat:mlops] ...` at creation time for platform detection visibility

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/mlops-integration.ts` — new module with MLOpsClient interface, MLFlowClient, WandbClient, CircuitBreaker, sanitizeMetricName, createMLOpsClient factory
- `src/resources/extensions/gsd/tests/mlops-integration.test.ts` — 105 contract tests covering full MLFlow lifecycle, RESOURCE_ALREADY_EXISTS fallback, full W&B lifecycle, auth header encoding, metric sanitization, circuit breaker open/close/recovery, factory credential resolution, non-fatal error handling, dashboard URL correctness
