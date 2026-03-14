# S06: Live MLOps Integration — Research

**Date:** 2026-03-13

## Summary

This slice owns R011 (Live MLOps Integration) — experiment metrics and orchestration metadata appearing in W&B/MLFlow dashboards in real-time while the loop runs. Per D004, this is a two-layer integration: Labrat logs orchestration metadata (experiment ID, keep/discard, timing, cost) via REST API, while the user's eval scripts handle domain metrics natively through their own W&B/MLFlow SDK calls.

The critical finding from research is that **W&B and MLFlow have fundamentally different API accessibility from TypeScript**. MLFlow has a clean, well-documented REST API that's trivially consumable from Node.js `fetch`. W&B has no documented public REST API for creating runs or logging metrics — its Python SDK communicates via an undocumented GraphQL API and a proprietary filestream endpoint. This means the W&B integration must either reverse-engineer the internal API (fragile) or use a shim approach (spawn a Python subprocess that calls the W&B SDK).

The recommended approach: build a provider-agnostic `MLOpsIntegration` interface with two concrete implementations — an `MLFlowClient` using the documented REST API, and a `WandbClient` that uses the W&B CLI/subprocess bridge (`wandb` CLI has a `sync` command, but for real-time logging, we need to reverse-engineer the GraphQL upsertBucket mutation for run creation and the filestream push endpoint). A more pragmatic alternative for W&B is to use the undocumented but stable `https://api.wandb.ai/graphql` endpoint with `upsertBucket` for run creation and `https://api.wandb.ai/files/{entity}/{project}/{run_id}/file_stream` for metric logging — these endpoints have been stable across SDK versions since they're the only wire protocol the Python SDK uses.

## Recommendation

**Build a thin integration layer with two backends:**

1. **MLFlow REST client** — straightforward HTTP calls to the documented 2.0 API. Create experiment → create run → log-batch metrics per experiment → update run status. Zero risk.

2. **W&B GraphQL/filestream client** — reverse-engineer the minimum viable wire protocol: one GraphQL mutation for `upsertBucket` (run creation/update) and POST to the filestream endpoint for metrics. Auth via `WANDB_API_KEY` as `Authorization: Basic api:<key>` (base64 encoded). This is the actual protocol the SDK uses — it's undocumented but has been stable since W&B v1. Alternative: shell out to `wandb sync` on a local directory, but this doesn't provide real-time logging.

3. **Integration module** — a new `mlops-integration.ts` file exporting a `logExperimentToMLOps()` function that fires after `runExperimentPostProcess` in `handleAgentEnd`. Non-fatal — if MLOps logging fails, experiment processing continues.

4. **Campaign-level session** — create an MLFlow experiment / W&B project run once at campaign start (in `startAuto` or on first experiment dispatch), reuse for all experiments. Each Labrat experiment maps to logged metrics at a step number.

5. **Dashboard URL resolver** — construct the platform-specific URL for the user's dashboard and store it for the morning report (S07).

**Why this approach:** MLFlow integration is clean and low-risk. W&B integration is riskier but achievable — the GraphQL API is the same one the SDK uses, and the auth pattern is documented via environment variables. Both integrations are optional — if neither platform is configured, the loop runs normally with local JSONL logging only.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| HTTP requests | Node.js native `fetch` (v22) | No npm dependency needed. Already available in this Node version. |
| JSON experiment log | `eval-runner.ts` JSONL append | S03 already handles crash-safe experiment logging. MLOps hooks read from this. |
| Metric comparison data | `ExperimentResult.decision.comparison` | Already contains per-metric before/after with improved boolean. |
| Campaign config / metadata | `parseCampaignConfig()` from `state.ts` | Already parses CAMPAIGN.json. Add optional MLOps config fields here. |
| Auth credential handling | Environment variables (`WANDB_API_KEY`, `MLFLOW_TRACKING_URI`) | Standard for both platforms. Don't invent custom auth. |

## Existing Code and Patterns

- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess()` returns `ExperimentResult` with all data needed for MLOps logging: metrics, decision, timing, cost, experiment ID. This is the data source.
- `src/resources/extensions/gsd/auto.ts` lines 587-606 — the `handleAgentEnd` hook for `run-experiment` units. MLOps logging should go here, after `runExperimentPostProcess` returns the result but before the budget guard. Non-fatal try/catch pattern already established.
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig`, `ExperimentResult`, `KeepDiscardDecision` types. CampaignConfig needs optional MLOps config fields added.
- `src/resources/extensions/gsd/preferences.ts` — `GSDResearchPreferences` interface. Could add MLOps platform preference here, but CAMPAIGN.json per-campaign config is more appropriate since different campaigns may use different projects/experiments.
- `src/resources/extensions/gsd/auto.ts` line 346 — `startAuto()` is the campaign lifecycle start. Good place to create the MLOps experiment/run session.
- `src/resources/extensions/gsd/state.ts` line 60 — `parseCampaignConfig()` validates CAMPAIGN.json. Extend validation for optional MLOps fields.

## Constraints

- **Node.js 22 / TypeScript only** — no npm dependencies for HTTP. Use native `fetch`. No Python SDK available.
- **Non-fatal integration** — MLOps logging failure must never block experiment dispatch or crash the loop. Every external call must be wrapped in try/catch.
- **No W&B documented REST API** — W&B only documents the Python SDK. The wire protocol (GraphQL + filestream) is reverse-engineered. It has been stable for years but could change without notice.
- **MLFlow assumes a running server** — MLFlow REST API requires a server at `MLFLOW_TRACKING_URI` (default `http://localhost:5000`). User must have `mlflow server` running or use a hosted instance.
- **Metric naming constraints** — W&B requires metric names matching `/^[_a-zA-Z][_a-zA-Z0-9]*$/`. MLFlow is more permissive. Labrat should sanitize metric names before logging to W&B.
- **Auth is environment-variable based** — `WANDB_API_KEY` for W&B, `MLFLOW_TRACKING_URI` for MLFlow endpoint. Optionally `WANDB_ENTITY`, `WANDB_PROJECT`, `WANDB_BASE_URL` for self-hosted W&B.
- **Campaign config owns MLOps settings** — per D012, CAMPAIGN.json in slice directory is the config location. MLOps config (platform, project/experiment name) should be optional fields there.
- **Two-layer integration per D004** — Labrat logs orchestration metadata only. The user's eval scripts log domain-specific metrics (loss curves, model artifacts) natively via their own SDK calls. Both write to the same platform, same experiment/run.

## Common Pitfalls

- **W&B GraphQL mutation schema changes** — The `upsertBucket` mutation parameters could change across W&B server versions. Mitigate by keeping the mutation minimal (only required fields) and failing gracefully with clear error messages. Log the exact GraphQL error for debugging.
- **MLFlow experiment ID caching** — `POST /experiments/create` returns RESOURCE_ALREADY_EXISTS if the name exists. Must handle this by falling back to `GET /experiments/get-by-name`. Do this once per campaign start, not per experiment.
- **Blocking the event loop with synchronous HTTP** — The existing `runEval` uses `spawnSync`. MLOps HTTP calls should NOT be synchronous. Use async `fetch` with a short timeout (5s). If the platform is unreachable, log the failure and move on.
- **W&B rate limiting** — W&B's internal API has undocumented rate limits. One request per experiment result is well within safe bounds, but batch-heavy patterns could trigger limits.
- **Metric name sanitization gap** — User-defined metric names from eval output (e.g., `val-bpb`, `test accuracy`) may not comply with W&B's `/^[_a-zA-Z][_a-zA-Z0-9]*$/` pattern. Must sanitize before logging.
- **Missing env vars = silent skip, not error** — If `WANDB_API_KEY` or `MLFLOW_TRACKING_URI` aren't set, MLOps integration should silently skip, not warn on every experiment. Log once at campaign start.

## Open Risks

- **W&B wire protocol stability** — The GraphQL endpoint and filestream protocol are undocumented. A W&B server update could break the integration. Mitigation: keep the client minimal, test against the current API, and degrade gracefully. The risk is acceptable because this is exactly the same protocol every W&B Python SDK version uses.
- **W&B filestream complexity** — The filestream endpoint (`/files/{entity}/{project}/{run_id}/file_stream`) expects a specific JSON format including history rows and summary data. Getting this format right without documentation requires trial-and-error or SDK source reading. Alternatively, we can use the simpler GraphQL `upsertBucket` mutation to update run summary metrics directly (less real-time but simpler).
- **MLFlow server availability** — If the user's MLFlow server goes down mid-campaign, every experiment will log a connection error. Need a circuit-breaker pattern: after N consecutive failures, stop attempting for M minutes.
- **Testing without live services** — Contract tests must mock HTTP responses. Need to design the client interface so the HTTP transport layer is injectable/mockable.

## Implementation Notes

### MLFlow REST API — Key Endpoints

All endpoints at `{MLFLOW_TRACKING_URI}/api/2.0/mlflow/`. Require `Content-Type: application/json`.

| Operation | Method | Path | Key Fields |
|-----------|--------|------|------------|
| Create Experiment | POST | `experiments/create` | `name` → returns `experiment_id` |
| Get Experiment By Name | GET | `experiments/get-by-name?experiment_name=X` | → returns `experiment` |
| Create Run | POST | `runs/create` | `experiment_id`, `run_name`, `start_time`, `tags[]` → returns `run` with `run_id` |
| Log Batch | POST | `runs/log-batch` | `run_id`, `metrics[]` (key/value/timestamp/step), `params[]`, `tags[]` |
| Log Metric | POST | `runs/log-metric` | `run_id`, `key`, `value`, `timestamp`, `step` |
| Set Tag | POST | `runs/set-tag` | `run_id`, `key`, `value` |
| Update Run | POST | `runs/update` | `run_id`, `status` (RUNNING/FINISHED/FAILED), `end_time` |

Log Batch limits: 1000 metrics + 100 params + 100 tags per request (1MB max).

### W&B API — Minimum Viable Wire Protocol

1. **Auth**: `Authorization: Basic` with base64(`api:<WANDB_API_KEY>`) — or just pass `WANDB_API_KEY` in the `X-WANDB-API-KEY` header.
2. **Run creation**: GraphQL `upsertBucket` mutation at `https://api.wandb.ai/graphql` (or `{WANDB_BASE_URL}/graphql` for self-hosted). Creates a run with `entity`, `project`, `name`, `config`, `summary`.
3. **Metric logging**: POST to `{base_url}/files/{entity}/{project}/{run_id}/file_stream` with JSON body containing `files` dict with `wandb-history.jsonl` entries (rows of metric dicts).
4. **Run finish**: Same `upsertBucket` mutation with state update.
5. **Dashboard URL**: `https://wandb.ai/{entity}/{project}/runs/{run_id}` (or `{base_url}/{entity}/{project}/runs/{run_id}` for self-hosted).

### Data Mapping

Per experiment result, Labrat logs to the MLOps platform:

**As metrics (numeric, per step):**
- All `ExperimentResult.metrics` values (the eval output metrics)
- `labrat.duration_ms` — experiment duration
- `labrat.cost_usd` — experiment cost
- `labrat.composite_score` — computed composite score (if available)

**As params/config (string, set once per run):**
- `labrat.campaign_name` — from CampaignConfig
- `labrat.research_question` — from CampaignConfig
- `labrat.target_files` — comma-separated list
- `labrat.eval_command` — the eval command

**As tags (string, per experiment):**
- `labrat.experiment_id` — e.g., "exp-003"
- `labrat.decision` — "keep" or "discard"
- `labrat.decision_reason` — full reason string

### CampaignConfig Extension

```typescript
// Add to CampaignConfig (optional fields):
mlops?: {
  platform: 'wandb' | 'mlflow';
  project?: string;      // W&B project or MLFlow experiment name
  entity?: string;       // W&B entity (optional, defaults to WANDB_ENTITY env)
  trackingUri?: string;  // MLFlow tracking URI (optional, defaults to MLFLOW_TRACKING_URI env)
};
```

### Module Structure

- `src/resources/extensions/gsd/mlops-integration.ts` — main module
  - `MLOpsClient` interface: `init(campaign)`, `logExperiment(result, step)`, `finish()`
  - `MLFlowClient` class: implements interface with REST API calls
  - `WandbClient` class: implements interface with GraphQL/filestream
  - `createMLOpsClient(config)` factory: reads CampaignConfig + env vars, returns appropriate client or null
  - `logExperimentToMLOps(client, result, step)` — the hook called from handleAgentEnd

### Integration Points in auto.ts

1. **Campaign start** (`startAuto` or first experiment dispatch): `client = await createMLOpsClient(campaignConfig)` — store in module-level variable alongside other auto-mode state.
2. **Per experiment** (in `handleAgentEnd`, after `runExperimentPostProcess`): `await logExperimentToMLOps(client, result, experimentNumber)`.
3. **Campaign end** (in `stopAuto` or milestone completion): `await client?.finish()` — mark run as FINISHED.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| W&B (wandb) | wandb/skills@wandb-primary | available (49 installs) — not installed; skill targets Python SDK usage, not REST/GraphQL integration from TypeScript |
| MLFlow | davila7/claude-code-templates@mlflow | available (220 installs) — not installed; skill targets Python MLFlow usage, not REST API from TypeScript |

Neither skill is relevant — both target Python SDK usage. Our integration is pure TypeScript REST/GraphQL calls.

## Sources

- MLFlow REST API reference — full endpoint documentation with request/response schemas (source: [MLFlow REST API Docs](https://mlflow.org/docs/latest/api_reference/rest-api.html))
- W&B environment variables — documents `WANDB_API_KEY`, `WANDB_BASE_URL`, `WANDB_ENTITY`, `WANDB_PROJECT` (source: [W&B Environment Variables](https://docs.wandb.ai/models/track/environment-variables))
- W&B experiment tracking overview — confirms Python SDK is the only documented interface for creating runs and logging metrics (source: [W&B Experiments Overview](https://docs.wandb.ai/guides/track))
- W&B Public API guide — confirms post-hoc querying (not real-time logging) via Python API; `Update metrics for a run, after the run has finished` example shows `run.summary` update pattern (source: [W&B Public API Guide](https://docs.wandb.ai/guides/track/public-api-guide))
- MLFlow Create Run endpoint — `POST 2.0/mlflow/runs/create` with `experiment_id`, `run_name`, `start_time`, `tags` (source: MLFlow REST API docs)
- MLFlow Log Batch endpoint — `POST 2.0/mlflow/runs/log-batch` with up to 1000 metrics per request (source: MLFlow REST API docs)
- MLFlow Data Structures — `Run`, `RunInfo`, `RunData`, `Metric`, `Param`, `RunTag` types (source: MLFlow REST API docs)
- Existing codebase: `eval-runner.ts` (S03), `auto.ts` handleAgentEnd hook, `types.ts` CampaignConfig/ExperimentResult, `state.ts` parseCampaignConfig, `preferences.ts` GSDResearchPreferences
