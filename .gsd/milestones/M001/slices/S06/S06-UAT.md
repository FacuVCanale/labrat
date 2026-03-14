# S06: Live MLOps Integration — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice is contract-tested with mocked fetch — no live MLOps servers are needed. The 105 contract tests prove HTTP request shapes, auth encoding, error handling, and circuit breaker behavior. Runtime integration will be validated in S07's end-to-end smoke test.

## Preconditions

- Repository builds clean (`npm run build` exits 0)
- All test dependencies available (`npx tsx` works)
- No live W&B or MLFlow server required

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts` — 105 tests pass. This confirms the entire integration module works: both platform clients, factory, circuit breaker, sanitizer, and error handling.

## Test Cases

### 1. MLFlow Full Lifecycle

1. Run the MLFlow lifecycle tests (covered by contract test suite)
2. Verify init creates experiment (POST `/api/2.0/mlflow/experiments/create`) with campaign name
3. Verify init creates run (POST `/api/2.0/mlflow/runs/create`) with experiment_id and campaign tags
4. Verify logExperiment sends log-batch (POST `/api/2.0/mlflow/runs/log-batch`) with metrics array containing step number and timestamp
5. Verify logExperiment sends set-tag for experiment_id and decision
6. Verify finish updates run status to FINISHED (POST `/api/2.0/mlflow/runs/update`)
7. **Expected:** All requests have correct URLs, methods, Content-Type headers, and JSON body shapes

### 2. MLFlow Experiment Already Exists Fallback

1. Mock experiments/create to return 400 with RESOURCE_ALREADY_EXISTS error code
2. Call init
3. **Expected:** Client falls back to get-by-name endpoint, extracts experiment_id from response, continues normally

### 3. W&B Full Lifecycle

1. Run the W&B lifecycle tests (covered by contract test suite)
2. Verify init sends GraphQL upsertBucket mutation with entity, project, run name, and config JSON
3. Verify Authorization header is `Basic <base64("api:<WANDB_API_KEY>")>`
4. Verify logExperiment sends filestream POST to `/files/<entity>/<project>/<runName>/file_stream` with metrics in `history` array
5. Verify finish sends GraphQL upsertBucket with `complete: true` to close the run
6. **Expected:** All requests have correct auth headers, URLs, and payload shapes

### 4. W&B Auth Encoding

1. Create W&B client with API key `test-key-123`
2. Inspect Authorization header on any request
3. **Expected:** Header is `Basic ` + base64 encoding of `api:test-key-123`

### 5. Metric Name Sanitization

1. Call `sanitizeMetricName("val/bpb")` → `val_bpb`
2. Call `sanitizeMetricName("123_metric")` → `_123_metric`
3. Call `sanitizeMetricName("hello world!")` → `hello_world_`
4. Call `sanitizeMetricName("valid_name")` → `valid_name` (unchanged)
5. **Expected:** All metric names match W&B's `/^[_a-zA-Z][_a-zA-Z0-9]*$/` constraint

### 6. Circuit Breaker Opens After Consecutive Failures

1. Create circuit breaker with threshold=3
2. Record 3 consecutive failures
3. **Expected:** Circuit breaker opens — `isOpen` is true, `failureCount` is 3, subsequent calls are rejected without executing

### 7. Circuit Breaker Half-Open Recovery

1. Open circuit breaker with 3 failures
2. Advance time past the reset timeout (5 minutes)
3. Call breaker — it should allow one probe call (half-open)
4. If probe succeeds, breaker closes (failureCount resets to 0)
5. **Expected:** Breaker transitions: closed → open → half-open → closed

### 8. Factory: Missing Credentials Returns Null

1. Call `createMLOpsClient` with MLFlow platform but no MLFLOW_TRACKING_URI set (env or config)
2. Call `createMLOpsClient` with W&B platform but no WANDB_API_KEY set
3. **Expected:** Both return null. Console shows one-time `[labrat:mlops]` message. No exceptions thrown.

### 9. Factory: Config Values Override Env Vars

1. Set env var `MLFLOW_TRACKING_URI=http://env-uri:5000`
2. Call `createMLOpsClient` with config.trackingUri = `http://config-uri:5000`
3. **Expected:** Client uses `http://config-uri:5000` (config takes precedence)

### 10. Factory: Unknown Platform

1. Call `createMLOpsClient` with platform `neptune`
2. **Expected:** Returns null with `[labrat:mlops] Unknown platform 'neptune'. Skipping.` log

### 11. Non-Fatal Error Handling

1. Create MLFlow client, call logExperiment, mock fetch to throw network error
2. **Expected:** logExperiment returns without throwing. Circuit breaker records failure. Experiment loop is not interrupted.

### 12. Dashboard URL Resolver

1. Create MLFlow client with tracking URI `http://mlflow.example.com:5000`, init with experiment
2. Call `getDashboardUrl()`
3. **Expected:** Returns `http://mlflow.example.com:5000/#/experiments/<id>`

4. Create W&B client with entity `my-team`, project `my-project`, init with run name `run-1`
5. Call `getDashboardUrl()`
6. **Expected:** Returns `https://wandb.ai/my-team/my-project/runs/run-1`

### 13. CampaignConfig.mlops Field

1. Parse a CampaignConfig with no `mlops` field
2. Parse a CampaignConfig with `mlops: { platform: "wandb", entity: "team", project: "proj" }`
3. **Expected:** Both parse successfully. The field is optional — missing mlops produces a valid config.

### 14. Auto.ts Lifecycle Wiring

1. Inspect auto.ts source for MLOps hooks
2. Verify `createMLOpsClient()` is called in `startAuto` after self-heal
3. Verify `mlopsClient?.logExperiment()` is called in `handleAgentEnd` inside try/catch
4. Verify `mlopsClient?.finish()` is called in `stopAuto` inside try/catch
5. **Expected:** All three lifecycle points present, all wrapped in non-fatal try/catch

## Edge Cases

### Circuit Breaker with Zero Failures

1. Create circuit breaker, never record failures
2. **Expected:** `isOpen` false, `failureCount` 0, `lastError` null

### logExperiment Before Init

1. Create client, call logExperiment without calling init first
2. **Expected:** Graceful handling — no crash, no uncaught exception (runId is null/undefined, request may fail but is caught by non-fatal wrapper)

### Empty Metrics Object

1. Call logExperiment with `ExperimentResult` containing empty metrics `{}`
2. **Expected:** Request is sent with empty metrics array. No crash.

## Failure Signals

- Any of the 105 contract tests failing
- `npm run build` reporting type errors in mlops-integration.ts, types.ts, or auto.ts
- Regression in eval-runner (73 tests), research-types (33 tests), or derive-state (113 tests)
- `createMLOpsClient` throwing instead of returning null on missing credentials
- Circuit breaker not opening after threshold failures
- MLOps errors propagating up and crashing the experiment loop

## Requirements Proved By This UAT

- R011 — Live MLOps Integration: W&B and MLFlow REST clients proven via contract tests. Auth, metric logging, lifecycle management, circuit breaker resilience, and non-fatal error handling all verified.

## Not Proven By This UAT

- Live runtime logging to actual W&B/MLFlow servers (would require running instances — deferred to manual validation)
- End-to-end flow where an experiment runs and metrics appear in a real dashboard (covered by S07 smoke test scope)
- Morning report displaying the dashboard URL (S07 scope)

## Notes for Tester

- All test cases map to contract tests in `mlops-integration.test.ts`. Running the test suite (`npx tsx src/resources/extensions/gsd/tests/mlops-integration.test.ts`) is the primary verification method.
- The W&B client uses undocumented GraphQL and filestream endpoints. These are stable in current W&B versions but could change. If W&B updates their API, contract tests will catch the shape mismatch.
- The auto.ts wiring is verified by source inspection rather than runtime testing — auto.ts requires a full experiment loop to exercise, which is S07's smoke test scope.
