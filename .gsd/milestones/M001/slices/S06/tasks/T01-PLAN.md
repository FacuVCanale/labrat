---
estimated_steps: 7
estimated_files: 2
---

# T01: Build MLOps client module with contract tests

**Slice:** S06 — Live MLOps Integration
**Milestone:** M001

## Description

Create the entire MLOps integration module as a standalone, independently testable unit. Two concrete client implementations (MLFlow REST, W&B GraphQL/filestream), a factory, circuit breaker, metric sanitizer, and dashboard URL resolver. Contract tests mock `global.fetch` to verify the exact HTTP request shapes, auth headers, and error handling without needing live services.

## Steps

1. Create `mlops-integration.ts` with the `MLOpsClient` interface: `init(campaign: {name: string, researchQuestion?: string, targetFiles: string[], evalCommand: string})`, `logExperiment(result: ExperimentResult, step: number)`, `finish()`, `getDashboardUrl(): string | null`.

2. Implement circuit breaker utility: tracks consecutive failure count, opens after 5 failures, closes after 5 minutes. Wraps async calls. Exposes state for diagnostics.

3. Implement `sanitizeMetricName(name: string): string` — replaces invalid chars with `_`, prepends `_` if starts with digit. Handles W&B's `/^[_a-zA-Z][_a-zA-Z0-9]*$/` constraint.

4. Implement `MLFlowClient`:
   - `init()`: POST `experiments/create` with campaign name. Handle `RESOURCE_ALREADY_EXISTS` by falling back to GET `experiments/get-by-name`. Then POST `runs/create` with experiment_id, run_name, start_time, tags (research question, target files, eval command).
   - `logExperiment()`: POST `runs/log-batch` with all metrics (eval metrics + labrat.duration_ms, labrat.cost_usd) at the given step. POST `runs/set-tag` for decision and experiment ID.
   - `finish()`: POST `runs/update` with status FINISHED and end_time.
   - `getDashboardUrl()`: construct `{trackingUri}/#/experiments/{experimentId}/runs/{runId}`.
   - Auth: none required for standard MLFlow server.

5. Implement `WandbClient`:
   - `init()`: GraphQL `upsertBucket` mutation at `{baseUrl}/graphql` to create run. Auth via `Authorization: Basic` with base64 `api:<WANDB_API_KEY>`. Set config (campaign name, research question, target files, eval command).
   - `logExperiment()`: POST to `{baseUrl}/files/{entity}/{project}/{runId}/file_stream` with history row containing sanitized metric names + labrat orchestration metrics. Include summary update.
   - `finish()`: GraphQL `upsertBucket` with state=finished.
   - `getDashboardUrl()`: construct `{baseUrl}/{entity}/{project}/runs/{runId}`.
   - Auth: `Authorization: Basic` header on all requests.

6. Implement `createMLOpsClient(config?: {platform: string, project?: string, entity?: string, trackingUri?: string})` factory:
   - If config?.platform is 'mlflow': check `MLFLOW_TRACKING_URI` env or config.trackingUri. Return `MLFlowClient` or null.
   - If config?.platform is 'wandb': check `WANDB_API_KEY` env. Return `WandbClient` or null.
   - If no config or no platform: return null (silent skip).
   - Log platform detection status once (for campaign start notification).

7. Write contract tests in `mlops-integration.test.ts` using mocked `global.fetch`:
   - MLFlow lifecycle: init creates experiment + run, logExperiment sends log-batch with correct metrics/step/tags, finish sends update with FINISHED status
   - MLFlow RESOURCE_ALREADY_EXISTS fallback to get-by-name
   - W&B lifecycle: init sends upsertBucket GraphQL mutation with correct auth header, logExperiment sends filestream POST with sanitized metrics, finish sends upsertBucket with finished state
   - W&B auth: verify base64 encoded `api:<key>` in Authorization header
   - Metric sanitization: `val-bpb` → `val_bpb`, `test accuracy` → `test_accuracy`, `3metric` → `_3metric`
   - Circuit breaker: 5 consecutive failures → calls stop, recovery after timeout
   - Missing credentials: `createMLOpsClient` returns null
   - Non-fatal: `logExperiment` catches fetch errors and doesn't throw
   - Dashboard URL correctness for both platforms

## Must-Haves

- [ ] MLOpsClient interface with init/logExperiment/finish/getDashboardUrl
- [ ] MLFlowClient implementation with REST API calls (create experiment, create run, log-batch, update run)
- [ ] WandbClient implementation with GraphQL + filestream (upsertBucket, file_stream POST)
- [ ] createMLOpsClient factory reading config + env vars, returning client or null
- [ ] Circuit breaker (5 consecutive failures → 5 min backoff)
- [ ] Metric name sanitization for W&B constraints
- [ ] Dashboard URL resolver for both platforms
- [ ] Contract tests with mocked fetch proving request shapes, auth, errors, circuit breaker

## Verification

- `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — all assertions pass
- `npm run build` — exits 0, no type errors

## Observability Impact

- Signals added: circuit breaker state (open/closed, consecutive failures, last error), platform detection log
- How a future agent inspects this: `getDashboardUrl()` for platform URL, circuit breaker exposes `isOpen` and `failureCount`
- Failure state exposed: last fetch error message stored in circuit breaker, `logExperiment` returns silently on failure (caller notified via return value or caught exception pattern)

## Inputs

- `src/resources/extensions/gsd/types.ts` — `ExperimentResult`, `KeepDiscardDecision` types that define the data to log
- S06-RESEARCH.md — MLFlow REST endpoints, W&B GraphQL mutation shape, filestream format, auth patterns
- `src/resources/extensions/gsd/tests/eval-runner.test.ts` — test pattern (bare assert, passed/failed counters, process.exit)

## Expected Output

- `src/resources/extensions/gsd/mlops-integration.ts` — complete module with both clients, factory, circuit breaker, sanitizer, URL resolver
- `src/resources/extensions/gsd/tests/mlops-integration.test.ts` — contract test suite proving all request shapes, auth, error handling, circuit breaker
