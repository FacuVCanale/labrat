/**
 * MLOps Integration — W&B and MLFlow client implementations.
 *
 * Logs experiment metrics and orchestration metadata to external MLOps
 * platforms. Non-fatal: failures never block the experiment loop.
 *
 * Two concrete clients:
 * - MLFlowClient: documented REST API (experiments/create, runs/create, runs/log-batch, runs/update)
 * - WandbClient: reverse-engineered GraphQL (upsertBucket) + filestream POST
 *
 * A circuit breaker protects against cascading failures when the platform is unreachable.
 */

import type { ExperimentResult } from './types.ts';

// ─── MLOps Client Interface ────────────────────────────────────────────────

export interface MLOpsCampaign {
  name: string;
  researchQuestion?: string;
  targetFiles: string[];
  evalCommand: string;
}

export interface MLOpsClient {
  init(campaign: MLOpsCampaign): Promise<void>;
  logExperiment(result: ExperimentResult, step: number): Promise<void>;
  finish(): Promise<void>;
  getDashboardUrl(): string | null;
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastError: string | null;
  openedAt: number | null;
}

export class CircuitBreaker {
  private failureCount = 0;
  private lastError: string | null = null;
  private openedAt: number | null = null;

  constructor(
    private readonly maxFailures: number = 5,
    private readonly resetTimeoutMs: number = 5 * 60 * 1000, // 5 minutes
    private readonly nowFn: () => number = Date.now,
  ) {}

  get state(): CircuitBreakerState {
    return {
      isOpen: this.isOpen,
      failureCount: this.failureCount,
      lastError: this.lastError,
      openedAt: this.openedAt,
    };
  }

  get isOpen(): boolean {
    if (this.failureCount < this.maxFailures) return false;
    // Check if reset timeout has elapsed
    if (this.openedAt !== null) {
      const elapsed = this.nowFn() - this.openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        // Half-open: allow next call to try
        return false;
      }
    }
    return true;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      throw new Error(`Circuit breaker open: ${this.lastError}`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.lastError = null;
    this.openedAt = null;
  }

  private onFailure(message: string): void {
    this.failureCount++;
    this.lastError = message;
    if (this.failureCount >= this.maxFailures && this.openedAt === null) {
      this.openedAt = this.nowFn();
    }
  }
}

// ─── Metric Name Sanitization ──────────────────────────────────────────────

/**
 * Sanitize metric names for W&B compatibility.
 * W&B requires: /^[_a-zA-Z][_a-zA-Z0-9]*$/
 * - Replace any invalid character with '_'
 * - Prepend '_' if starts with a digit
 */
export function sanitizeMetricName(name: string): string {
  // Replace any char that isn't [_a-zA-Z0-9] with underscore
  let sanitized = name.replace(/[^_a-zA-Z0-9]/g, '_');
  // Prepend underscore if starts with digit
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  return sanitized;
}

// ─── MLFlow Client ─────────────────────────────────────────────────────────

export class MLFlowClient implements MLOpsClient {
  private experimentId: string | null = null;
  private runId: string | null = null;
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly trackingUri: string,
    breaker?: CircuitBreaker,
  ) {
    this.breaker = breaker ?? new CircuitBreaker();
  }

  get circuitBreaker(): CircuitBreaker {
    return this.breaker;
  }

  async init(campaign: MLOpsCampaign): Promise<void> {
    const baseUrl = `${this.trackingUri}/api/2.0/mlflow`;

    // Create experiment (or get existing)
    try {
      const createRes = await this.breaker.call(() =>
        fetch(`${baseUrl}/experiments/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: campaign.name }),
        }),
      );
      const createBody = await createRes.json() as Record<string, unknown>;
      if (createRes.ok) {
        this.experimentId = (createBody as { experiment_id: string }).experiment_id;
      } else if (
        (createBody as { error_code?: string }).error_code === 'RESOURCE_ALREADY_EXISTS'
      ) {
        // Fall back to get-by-name
        const getRes = await this.breaker.call(() =>
          fetch(`${baseUrl}/experiments/get-by-name?experiment_name=${encodeURIComponent(campaign.name)}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        const getBody = await getRes.json() as { experiment: { experiment_id: string } };
        this.experimentId = getBody.experiment.experiment_id;
      } else {
        throw new Error(`MLFlow create experiment failed: ${JSON.stringify(createBody)}`);
      }
    } catch (err) {
      throw new Error(`MLFlow init failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Create run
    const tags = [
      { key: 'labrat.eval_command', value: campaign.evalCommand },
      { key: 'labrat.target_files', value: campaign.targetFiles.join(',') },
    ];
    if (campaign.researchQuestion) {
      tags.push({ key: 'labrat.research_question', value: campaign.researchQuestion });
    }

    const runRes = await this.breaker.call(() =>
      fetch(`${this.trackingUri}/api/2.0/mlflow/runs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experiment_id: this.experimentId,
          run_name: `labrat-${campaign.name}-${Date.now()}`,
          start_time: Date.now(),
          tags,
        }),
      }),
    );
    const runBody = await runRes.json() as { run: { info: { run_id: string } } };
    this.runId = runBody.run.info.run_id;
  }

  async logExperiment(result: ExperimentResult, step: number): Promise<void> {
    if (!this.runId) return;

    const timestamp = Date.now();
    const metrics: Array<{ key: string; value: number; timestamp: number; step: number }> = [];

    // Add eval metrics
    for (const [key, value] of Object.entries(result.metrics)) {
      metrics.push({ key, value, timestamp, step });
    }

    // Add labrat orchestration metrics
    metrics.push({ key: 'labrat.duration_ms', value: result.duration, timestamp, step });
    metrics.push({ key: 'labrat.cost_usd', value: result.cost, timestamp, step });

    try {
      // Log metrics batch
      await this.breaker.call(() =>
        fetch(`${this.trackingUri}/api/2.0/mlflow/runs/log-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ run_id: this.runId, metrics }),
        }),
      );

      // Set tags for decision and experiment ID
      await this.breaker.call(() =>
        fetch(`${this.trackingUri}/api/2.0/mlflow/runs/set-tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_id: this.runId,
            key: `labrat.experiment.${result.id}.decision`,
            value: result.decision.decision,
          }),
        }),
      );
      await this.breaker.call(() =>
        fetch(`${this.trackingUri}/api/2.0/mlflow/runs/set-tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_id: this.runId,
            key: `labrat.experiment.${result.id}.id`,
            value: result.id,
          }),
        }),
      );
    } catch {
      // Non-fatal: swallow errors from logExperiment
    }
  }

  async finish(): Promise<void> {
    if (!this.runId) return;

    try {
      await this.breaker.call(() =>
        fetch(`${this.trackingUri}/api/2.0/mlflow/runs/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_id: this.runId,
            status: 'FINISHED',
            end_time: Date.now(),
          }),
        }),
      );
    } catch {
      // Non-fatal
    }
  }

  getDashboardUrl(): string | null {
    if (!this.experimentId || !this.runId) return null;
    return `${this.trackingUri}/#/experiments/${this.experimentId}/runs/${this.runId}`;
  }
}

// ─── W&B Client ────────────────────────────────────────────────────────────

export class WandbClient implements MLOpsClient {
  private runId: string | null = null;
  private readonly breaker: CircuitBreaker;
  private readonly authHeader: string;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly entity: string,
    private readonly project: string,
    breaker?: CircuitBreaker,
  ) {
    this.breaker = breaker ?? new CircuitBreaker();
    // Authorization: Basic base64("api:<key>")
    // Use Buffer for Node.js environment
    this.authHeader = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;
  }

  get circuitBreaker(): CircuitBreaker {
    return this.breaker;
  }

  async init(campaign: MLOpsCampaign): Promise<void> {
    const mutation = `
      mutation UpsertBucket($entity: String!, $project: String!, $name: String!, $config: JSONString, $description: String) {
        upsertBucket(input: {
          entityName: $entity,
          projectName: $project,
          name: $name,
          config: $config,
          description: $description
        }) {
          bucket {
            id
            name
          }
        }
      }
    `;

    const config = JSON.stringify({
      'labrat.campaign_name': { value: campaign.name },
      'labrat.target_files': { value: campaign.targetFiles.join(',') },
      'labrat.eval_command': { value: campaign.evalCommand },
      ...(campaign.researchQuestion
        ? { 'labrat.research_question': { value: campaign.researchQuestion } }
        : {}),
    });

    const runName = `labrat-${campaign.name}-${Date.now()}`;

    const res = await this.breaker.call(() =>
      fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            entity: this.entity,
            project: this.project,
            name: runName,
            config,
            description: campaign.researchQuestion ?? '',
          },
        }),
      }),
    );

    const body = await res.json() as {
      data: { upsertBucket: { bucket: { id: string; name: string } } };
    };
    this.runId = body.data.upsertBucket.bucket.name;
  }

  async logExperiment(result: ExperimentResult, step: number): Promise<void> {
    if (!this.runId) return;

    // Build the history row with sanitized metric names
    const historyRow: Record<string, number> = { _step: step };
    for (const [key, value] of Object.entries(result.metrics)) {
      historyRow[sanitizeMetricName(key)] = value;
    }
    historyRow[sanitizeMetricName('labrat.duration_ms')] = result.duration;
    historyRow[sanitizeMetricName('labrat.cost_usd')] = result.cost;

    // Build summary (latest values)
    const summary: Record<string, number> = {};
    for (const [key, value] of Object.entries(historyRow)) {
      if (key !== '_step') summary[key] = value;
    }

    const filestreamBody = {
      files: {
        'wandb-history.jsonl': {
          content: [JSON.stringify(historyRow)],
        },
        'wandb-summary.json': {
          content: [JSON.stringify(summary)],
        },
      },
    };

    try {
      await this.breaker.call(() =>
        fetch(
          `${this.baseUrl}/files/${this.entity}/${this.project}/${this.runId}/file_stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: this.authHeader,
            },
            body: JSON.stringify(filestreamBody),
          },
        ),
      );
    } catch {
      // Non-fatal: swallow errors from logExperiment
    }
  }

  async finish(): Promise<void> {
    if (!this.runId) return;

    const mutation = `
      mutation UpsertBucket($entity: String!, $project: String!, $name: String!, $state: String) {
        upsertBucket(input: {
          entityName: $entity,
          projectName: $project,
          name: $name,
          state: $state
        }) {
          bucket {
            id
            name
          }
        }
      }
    `;

    try {
      await this.breaker.call(() =>
        fetch(`${this.baseUrl}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.authHeader,
          },
          body: JSON.stringify({
            query: mutation,
            variables: {
              entity: this.entity,
              project: this.project,
              name: this.runId,
              state: 'finished',
            },
          }),
        }),
      );
    } catch {
      // Non-fatal
    }
  }

  getDashboardUrl(): string | null {
    if (!this.runId) return null;
    return `${this.baseUrl}/${this.entity}/${this.project}/runs/${this.runId}`;
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

export interface MLOpsConfig {
  platform: string;
  project?: string;
  entity?: string;
  trackingUri?: string;
}

/**
 * Create an MLOps client from config and environment variables.
 * Returns null if no platform configured or credentials missing.
 * Never throws — missing config is a silent skip.
 */
export function createMLOpsClient(config?: MLOpsConfig): MLOpsClient | null {
  if (!config?.platform) {
    return null;
  }

  if (config.platform === 'mlflow') {
    const trackingUri = config.trackingUri ?? process.env.MLFLOW_TRACKING_URI;
    if (!trackingUri) {
      console.log('[labrat:mlops] MLFlow platform configured but no tracking URI found (set MLFLOW_TRACKING_URI or config.trackingUri). Skipping.');
      return null;
    }
    console.log(`[labrat:mlops] MLFlow client created, tracking URI: ${trackingUri}`);
    return new MLFlowClient(trackingUri);
  }

  if (config.platform === 'wandb') {
    const apiKey = process.env.WANDB_API_KEY;
    if (!apiKey) {
      console.log('[labrat:mlops] W&B platform configured but WANDB_API_KEY not set. Skipping.');
      return null;
    }
    const baseUrl = process.env.WANDB_BASE_URL ?? config.trackingUri ?? 'https://api.wandb.ai';
    const entity = config.entity ?? process.env.WANDB_ENTITY ?? 'default';
    const project = config.project ?? process.env.WANDB_PROJECT ?? 'labrat';
    console.log(`[labrat:mlops] W&B client created, entity: ${entity}, project: ${project}`);
    return new WandbClient(baseUrl, apiKey, entity, project);
  }

  console.log(`[labrat:mlops] Unknown platform '${config.platform}'. Skipping.`);
  return null;
}
