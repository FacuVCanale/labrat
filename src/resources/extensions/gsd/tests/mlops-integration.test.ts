/**
 * Contract tests for MLOps integration module.
 * Mocks global.fetch to verify exact HTTP request shapes, auth headers,
 * error handling, and circuit breaker behavior without live services.
 */

import {
  CircuitBreaker,
  sanitizeMetricName,
  MLFlowClient,
  WandbClient,
  createMLOpsClient,
} from '../mlops-integration.ts';

import type { ExperimentResult, KeepDiscardDecision } from '../types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeResult(overrides?: Partial<ExperimentResult>): ExperimentResult {
  return {
    id: 'exp-001',
    description: 'Test experiment',
    metrics: { 'val-bpb': 1.23, 'test accuracy': 0.95 },
    decision: {
      decision: 'keep',
      reason: 'Improved metrics',
      comparison: {
        'val-bpb': { before: 1.5, after: 1.23, improved: true },
        'test accuracy': { before: 0.9, after: 0.95, improved: true },
      },
    },
    duration: 5000,
    cost: 0.12,
    diff: '+10 -3',
    ...overrides,
  };
}

// ─── Fetch Mock Infrastructure ──────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let capturedRequests: CapturedRequest[] = [];
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];
let fetchResponseIndex = 0;

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>): void {
  capturedRequests = [];
  fetchResponses = responses;
  fetchResponseIndex = 0;

  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k] = v;
      }
    }

    let body: unknown = undefined;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    capturedRequests.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body,
    });

    const response = fetchResponses[fetchResponseIndex] ?? { ok: true, status: 200, body: {} };
    if (fetchResponseIndex < fetchResponses.length - 1) {
      fetchResponseIndex++;
    }

    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  };
}

function mockFetchError(errorMessage: string): void {
  capturedRequests = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (): Promise<Response> => {
    throw new Error(errorMessage);
  };
}

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // Metric Name Sanitization
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Metric Name Sanitization ---');

  assertEq(sanitizeMetricName('val-bpb'), 'val_bpb', 'hyphen → underscore');
  assertEq(sanitizeMetricName('test accuracy'), 'test_accuracy', 'space → underscore');
  assertEq(sanitizeMetricName('3metric'), '_3metric', 'leading digit → prepend underscore');
  assertEq(sanitizeMetricName('good_name'), 'good_name', 'valid name unchanged');
  assertEq(sanitizeMetricName('_private'), '_private', 'leading underscore preserved');
  assertEq(sanitizeMetricName('a.b.c'), 'a_b_c', 'dots → underscores');
  assertEq(sanitizeMetricName('labrat.duration_ms'), 'labrat_duration_ms', 'dot in labrat prefix');

  // ═══════════════════════════════════════════════════════════════════════
  // Circuit Breaker
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Circuit Breaker ---');

  {
    // Opens after 5 consecutive failures
    const breaker = new CircuitBreaker(5, 300_000);
    let callCount = 0;
    const failingFn = async () => {
      callCount++;
      throw new Error('fail');
    };

    for (let i = 0; i < 5; i++) {
      try {
        await breaker.call(failingFn);
      } catch {
        // expected
      }
    }
    assertEq(callCount, 5, 'called 5 times before open');
    assert(breaker.isOpen, 'breaker opens after 5 failures');
    assertEq(breaker.state.failureCount, 5, 'failure count is 5');
    assert(breaker.state.lastError === 'fail', 'last error recorded');

    // 6th call should be blocked
    let blockedError: Error | null = null;
    try {
      await breaker.call(failingFn);
    } catch (e) {
      blockedError = e as Error;
    }
    assertEq(callCount, 5, 'no additional call when breaker is open');
    assert(blockedError !== null, 'error thrown when breaker is open');
    assert(blockedError!.message.includes('Circuit breaker open'), 'error message indicates open breaker');
  }

  {
    // Resets after success
    const breaker = new CircuitBreaker(5, 300_000);
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.call(async () => { throw new Error('fail'); });
      } catch {
        // expected
      }
    }
    assertEq(breaker.state.failureCount, 3, 'failure count is 3 after 3 failures');

    await breaker.call(async () => 'ok');
    assertEq(breaker.state.failureCount, 0, 'failure count resets on success');
    assert(!breaker.isOpen, 'breaker remains closed after success reset');
  }

  {
    // Recovery after timeout (half-open)
    let now = 1000;
    const breaker = new CircuitBreaker(5, 300_000, () => now);

    for (let i = 0; i < 5; i++) {
      try {
        await breaker.call(async () => { throw new Error('fail'); });
      } catch {
        // expected
      }
    }
    assert(breaker.isOpen, 'breaker is open immediately');

    // Advance past timeout
    now += 300_001;
    assert(!breaker.isOpen, 'breaker half-opens after timeout');

    // Successful call resets
    await breaker.call(async () => 'recovered');
    assertEq(breaker.state.failureCount, 0, 'failure count reset after recovery');
    assert(!breaker.isOpen, 'breaker fully closes after recovery success');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MLFlow Client — Init Lifecycle
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- MLFlow: Init Lifecycle ---');

  {
    mockFetch([
      // experiments/create
      { ok: true, status: 200, body: { experiment_id: 'exp-123' } },
      // runs/create
      {
        ok: true,
        status: 200,
        body: { run: { info: { run_id: 'run-456' } } },
      },
    ]);

    const client = new MLFlowClient('http://localhost:5000');
    await client.init({
      name: 'test-campaign',
      researchQuestion: 'Does X improve Y?',
      targetFiles: ['model.py', 'config.json'],
      evalCommand: 'python eval.py',
    });

    assertEq(capturedRequests.length, 2, 'MLFlow init sends 2 requests');

    // Verify experiment creation
    const createReq = capturedRequests[0];
    assert(createReq.url.includes('/experiments/create'), 'first request creates experiment');
    assertEq(createReq.method, 'POST', 'experiment create is POST');
    assertEq((createReq.body as { name: string }).name, 'test-campaign', 'experiment name matches');

    // Verify run creation
    const runReq = capturedRequests[1];
    assert(runReq.url.includes('/runs/create'), 'second request creates run');
    assertEq(runReq.method, 'POST', 'run create is POST');
    const runBody = runReq.body as {
      experiment_id: string;
      run_name: string;
      tags: Array<{ key: string; value: string }>;
    };
    assertEq(runBody.experiment_id, 'exp-123', 'run references experiment ID');
    assert(runBody.run_name.startsWith('labrat-test-campaign-'), 'run name includes campaign');
    assert(runBody.tags.some((t: { key: string }) => t.key === 'labrat.eval_command'), 'tags include eval command');
    assert(runBody.tags.some((t: { key: string }) => t.key === 'labrat.research_question'), 'tags include research question');
    assert(runBody.tags.some((t: { key: string }) => t.key === 'labrat.target_files'), 'tags include target files');

    // Verify dashboard URL
    const url = client.getDashboardUrl();
    assertEq(url, 'http://localhost:5000/#/experiments/exp-123/runs/run-456', 'MLFlow dashboard URL correct');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MLFlow Client — RESOURCE_ALREADY_EXISTS Fallback
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- MLFlow: RESOURCE_ALREADY_EXISTS Fallback ---');

  {
    mockFetch([
      // experiments/create → conflict
      {
        ok: false,
        status: 400,
        body: { error_code: 'RESOURCE_ALREADY_EXISTS', message: 'Experiment already exists' },
      },
      // experiments/get-by-name → success
      {
        ok: true,
        status: 200,
        body: { experiment: { experiment_id: 'existing-789' } },
      },
      // runs/create
      {
        ok: true,
        status: 200,
        body: { run: { info: { run_id: 'run-fallback' } } },
      },
    ]);

    const client = new MLFlowClient('http://localhost:5000');
    await client.init({
      name: 'existing-campaign',
      targetFiles: ['a.py'],
      evalCommand: 'python eval.py',
    });

    assertEq(capturedRequests.length, 3, 'MLFlow fallback sends 3 requests');

    // Verify get-by-name fallback
    const getReq = capturedRequests[1];
    assert(getReq.url.includes('/experiments/get-by-name'), 'falls back to get-by-name');
    assert(getReq.url.includes('experiment_name=existing-campaign'), 'get-by-name uses correct name');
    assertEq(getReq.method, 'GET', 'get-by-name is GET');

    // Verify URL uses existing experiment ID
    const url = client.getDashboardUrl();
    assert(url !== null && url.includes('existing-789'), 'dashboard URL uses existing experiment ID');
    assert(url !== null && url.includes('run-fallback'), 'dashboard URL uses fallback run ID');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MLFlow Client — logExperiment
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- MLFlow: logExperiment ---');

  {
    mockFetch([
      // init responses
      { ok: true, status: 200, body: { experiment_id: 'exp-1' } },
      { ok: true, status: 200, body: { run: { info: { run_id: 'run-1' } } } },
      // log-batch
      { ok: true, status: 200, body: {} },
      // set-tag (decision)
      { ok: true, status: 200, body: {} },
      // set-tag (experiment id)
      { ok: true, status: 200, body: {} },
    ]);

    const client = new MLFlowClient('http://localhost:5000');
    await client.init({
      name: 'test',
      targetFiles: ['a.py'],
      evalCommand: 'python eval.py',
    });

    const result = makeResult();
    await client.logExperiment(result, 3);

    // Verify log-batch
    const logBatchReq = capturedRequests[2];
    assert(logBatchReq.url.includes('/runs/log-batch'), 'logExperiment sends log-batch');
    assertEq(logBatchReq.method, 'POST', 'log-batch is POST');
    const logBody = logBatchReq.body as {
      run_id: string;
      metrics: Array<{ key: string; value: number; step: number }>;
    };
    assertEq(logBody.run_id, 'run-1', 'log-batch references run ID');

    // Verify metrics include eval + labrat metrics
    const metricKeys = logBody.metrics.map((m: { key: string }) => m.key);
    assert(metricKeys.includes('val-bpb'), 'includes val-bpb metric');
    assert(metricKeys.includes('test accuracy'), 'includes test accuracy metric');
    assert(metricKeys.includes('labrat.duration_ms'), 'includes duration metric');
    assert(metricKeys.includes('labrat.cost_usd'), 'includes cost metric');

    // Verify step
    assert(logBody.metrics.every((m: { step: number }) => m.step === 3), 'all metrics at step 3');

    // Verify tags
    const tagReq = capturedRequests[3];
    assert(tagReq.url.includes('/runs/set-tag'), 'logExperiment sends set-tag');
    const tagBody = tagReq.body as { run_id: string; key: string; value: string };
    assertEq(tagBody.run_id, 'run-1', 'tag references run ID');
    assert(tagBody.key.includes('decision'), 'tag key includes decision');
    assertEq(tagBody.value, 'keep', 'tag value is decision result');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MLFlow Client — finish
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- MLFlow: finish ---');

  {
    mockFetch([
      // init
      { ok: true, status: 200, body: { experiment_id: 'exp-1' } },
      { ok: true, status: 200, body: { run: { info: { run_id: 'run-1' } } } },
      // finish update
      { ok: true, status: 200, body: {} },
    ]);

    const client = new MLFlowClient('http://localhost:5000');
    await client.init({
      name: 'test',
      targetFiles: ['a.py'],
      evalCommand: 'python eval.py',
    });

    await client.finish();

    const finishReq = capturedRequests[2];
    assert(finishReq.url.includes('/runs/update'), 'finish sends runs/update');
    assertEq(finishReq.method, 'POST', 'runs/update is POST');
    const finishBody = finishReq.body as { run_id: string; status: string; end_time: number };
    assertEq(finishBody.run_id, 'run-1', 'finish references run ID');
    assertEq(finishBody.status, 'FINISHED', 'finish sends FINISHED status');
    assert(typeof finishBody.end_time === 'number', 'finish includes end_time');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // W&B Client — Init Lifecycle
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- W&B: Init Lifecycle ---');

  {
    mockFetch([
      // upsertBucket
      {
        ok: true,
        status: 200,
        body: {
          data: {
            upsertBucket: {
              bucket: { id: 'wandb-run-id', name: 'labrat-test-run' },
            },
          },
        },
      },
    ]);

    const client = new WandbClient('https://api.wandb.ai', 'test-api-key', 'my-entity', 'my-project');
    await client.init({
      name: 'test-campaign',
      researchQuestion: 'Does X improve Y?',
      targetFiles: ['model.py'],
      evalCommand: 'python eval.py',
    });

    assertEq(capturedRequests.length, 1, 'W&B init sends 1 GraphQL request');

    const initReq = capturedRequests[0];
    assert(initReq.url.includes('/graphql'), 'init posts to /graphql');
    assertEq(initReq.method, 'POST', 'init is POST');

    // Verify auth header
    const expectedAuth = `Basic ${Buffer.from('api:test-api-key').toString('base64')}`;
    assertEq(initReq.headers['Authorization'], expectedAuth, 'W&B auth header is correct base64 encoding');

    // Verify GraphQL body
    const gqlBody = initReq.body as {
      query: string;
      variables: {
        entity: string;
        project: string;
        name: string;
        config: string;
      };
    };
    assert(gqlBody.query.includes('upsertBucket'), 'mutation is upsertBucket');
    assertEq(gqlBody.variables.entity, 'my-entity', 'entity in variables');
    assertEq(gqlBody.variables.project, 'my-project', 'project in variables');
    assert(gqlBody.variables.name.startsWith('labrat-test-campaign-'), 'run name in variables');

    // Verify config contains campaign info
    const config = JSON.parse(gqlBody.variables.config) as Record<string, { value: string }>;
    assertEq(config['labrat.campaign_name'].value, 'test-campaign', 'config has campaign name');
    assertEq(config['labrat.eval_command'].value, 'python eval.py', 'config has eval command');
    assertEq(config['labrat.research_question'].value, 'Does X improve Y?', 'config has research question');

    // Verify dashboard URL
    const url = client.getDashboardUrl();
    assertEq(url, 'https://api.wandb.ai/my-entity/my-project/runs/labrat-test-run', 'W&B dashboard URL correct');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // W&B Client — logExperiment (filestream)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- W&B: logExperiment (filestream) ---');

  {
    mockFetch([
      // init
      {
        ok: true,
        status: 200,
        body: {
          data: {
            upsertBucket: {
              bucket: { id: 'wandb-id', name: 'run-x' },
            },
          },
        },
      },
      // filestream POST
      { ok: true, status: 200, body: {} },
    ]);

    const client = new WandbClient('https://api.wandb.ai', 'key123', 'ent', 'proj');
    await client.init({
      name: 'test',
      targetFiles: ['a.py'],
      evalCommand: 'python eval.py',
    });

    const result = makeResult();
    await client.logExperiment(result, 5);

    assertEq(capturedRequests.length, 2, 'W&B logExperiment sends 1 additional request');

    const fsReq = capturedRequests[1];
    assert(fsReq.url.includes('/files/ent/proj/run-x/file_stream'), 'filestream URL correct');
    assertEq(fsReq.method, 'POST', 'filestream is POST');

    // Verify auth on filestream
    const expectedAuth = `Basic ${Buffer.from('api:key123').toString('base64')}`;
    assertEq(fsReq.headers['Authorization'], expectedAuth, 'filestream has auth header');

    // Verify body has sanitized metric names
    const fsBody = fsReq.body as {
      files: {
        'wandb-history.jsonl': { content: string[] };
        'wandb-summary.json': { content: string[] };
      };
    };
    assert(fsBody.files['wandb-history.jsonl'] !== undefined, 'body has wandb-history.jsonl');
    const historyRow = JSON.parse(fsBody.files['wandb-history.jsonl'].content[0]) as Record<string, number>;
    assert('val_bpb' in historyRow, 'val-bpb sanitized to val_bpb in history');
    assert('test_accuracy' in historyRow, 'test accuracy sanitized to test_accuracy in history');
    assert('labrat_duration_ms' in historyRow, 'labrat.duration_ms sanitized');
    assert('labrat_cost_usd' in historyRow, 'labrat.cost_usd sanitized');
    assertEq(historyRow._step, 5, 'step included in history row');

    // Verify summary
    assert(fsBody.files['wandb-summary.json'] !== undefined, 'body has wandb-summary.json');
    const summary = JSON.parse(fsBody.files['wandb-summary.json'].content[0]) as Record<string, number>;
    assert('val_bpb' in summary, 'sanitized metric in summary');
    assert(!('_step' in summary), '_step not in summary');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // W&B Client — finish
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- W&B: finish ---');

  {
    mockFetch([
      // init
      {
        ok: true,
        status: 200,
        body: {
          data: {
            upsertBucket: {
              bucket: { id: 'id', name: 'run-fin' },
            },
          },
        },
      },
      // finish mutation
      {
        ok: true,
        status: 200,
        body: {
          data: { upsertBucket: { bucket: { id: 'id', name: 'run-fin' } } },
        },
      },
    ]);

    const client = new WandbClient('https://api.wandb.ai', 'k', 'e', 'p');
    await client.init({
      name: 'test',
      targetFiles: [],
      evalCommand: 'cmd',
    });

    await client.finish();

    const finishReq = capturedRequests[1];
    assert(finishReq.url.includes('/graphql'), 'finish posts to /graphql');
    const finishBody = finishReq.body as {
      query: string;
      variables: { name: string; state: string };
    };
    assert(finishBody.query.includes('upsertBucket'), 'finish mutation is upsertBucket');
    assertEq(finishBody.variables.state, 'finished', 'finish sends state=finished');
    assertEq(finishBody.variables.name, 'run-fin', 'finish references run name');

    // Verify auth on finish
    assert(finishReq.headers['Authorization'] !== undefined, 'finish has auth header');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // W&B Auth — Base64 Encoding
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- W&B: Auth Base64 Encoding ---');

  {
    mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          data: { upsertBucket: { bucket: { id: 'x', name: 'y' } } },
        },
      },
    ]);

    const testKey = 'my-secret-api-key-12345';
    const client = new WandbClient('https://api.wandb.ai', testKey, 'e', 'p');
    await client.init({ name: 'test', targetFiles: [], evalCommand: 'cmd' });

    const authHeader = capturedRequests[0].headers['Authorization'];
    const expectedEncoded = Buffer.from(`api:${testKey}`).toString('base64');
    assertEq(authHeader, `Basic ${expectedEncoded}`, 'auth header is Basic base64(api:<key>)');

    // Decode and verify
    const decoded = Buffer.from(expectedEncoded, 'base64').toString('utf-8');
    assertEq(decoded, `api:${testKey}`, 'decoded auth matches api:<key> format');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // logExperiment — Non-Fatal (fetch errors swallowed)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- logExperiment: Non-Fatal on Errors ---');

  {
    // MLFlow: init succeeds, then logExperiment fails
    mockFetch([
      { ok: true, status: 200, body: { experiment_id: 'exp-1' } },
      { ok: true, status: 200, body: { run: { info: { run_id: 'run-1' } } } },
    ]);

    const client = new MLFlowClient('http://localhost:5000');
    await client.init({
      name: 'test',
      targetFiles: ['a.py'],
      evalCommand: 'cmd',
    });

    // Now make fetch throw
    mockFetchError('Network unreachable');

    let threw = false;
    try {
      await client.logExperiment(makeResult(), 1);
    } catch {
      threw = true;
    }
    assert(!threw, 'MLFlow logExperiment does not throw on fetch error');

    restoreFetch();
  }

  {
    // W&B: init succeeds, then logExperiment fails
    mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          data: { upsertBucket: { bucket: { id: 'x', name: 'y' } } },
        },
      },
    ]);

    const client = new WandbClient('https://api.wandb.ai', 'k', 'e', 'p');
    await client.init({ name: 'test', targetFiles: [], evalCommand: 'cmd' });

    mockFetchError('Connection refused');

    let threw = false;
    try {
      await client.logExperiment(makeResult(), 1);
    } catch {
      threw = true;
    }
    assert(!threw, 'W&B logExperiment does not throw on fetch error');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // createMLOpsClient — Factory
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- createMLOpsClient Factory ---');

  {
    // No config → null
    const noConfig = createMLOpsClient();
    assert(noConfig === null, 'no config returns null');

    // Empty platform → null
    const emptyPlatform = createMLOpsClient({ platform: '' });
    assert(emptyPlatform === null, 'empty platform returns null');

    // Unknown platform → null
    const unknownPlatform = createMLOpsClient({ platform: 'neptune' });
    assert(unknownPlatform === null, 'unknown platform returns null');

    // MLFlow with tracking URI in config
    const mlflowClient = createMLOpsClient({
      platform: 'mlflow',
      trackingUri: 'http://localhost:5000',
    });
    assert(mlflowClient !== null, 'MLFlow with trackingUri returns client');
    assert(mlflowClient instanceof MLFlowClient, 'returns MLFlowClient instance');

    // MLFlow without URI or env var → null
    const origUri = process.env.MLFLOW_TRACKING_URI;
    delete process.env.MLFLOW_TRACKING_URI;
    const noUri = createMLOpsClient({ platform: 'mlflow' });
    assert(noUri === null, 'MLFlow without tracking URI returns null');
    if (origUri) process.env.MLFLOW_TRACKING_URI = origUri;

    // MLFlow with env var
    process.env.MLFLOW_TRACKING_URI = 'http://env-uri:5000';
    const mlflowFromEnv = createMLOpsClient({ platform: 'mlflow' });
    assert(mlflowFromEnv !== null, 'MLFlow with env var returns client');
    delete process.env.MLFLOW_TRACKING_URI;

    // W&B without API key → null
    const origKey = process.env.WANDB_API_KEY;
    delete process.env.WANDB_API_KEY;
    const noKey = createMLOpsClient({ platform: 'wandb' });
    assert(noKey === null, 'W&B without WANDB_API_KEY returns null');

    // W&B with API key
    process.env.WANDB_API_KEY = 'test-key';
    const wandbClient = createMLOpsClient({
      platform: 'wandb',
      entity: 'test-entity',
      project: 'test-project',
    });
    assert(wandbClient !== null, 'W&B with API key returns client');
    assert(wandbClient instanceof WandbClient, 'returns WandbClient instance');
    delete process.env.WANDB_API_KEY;
    if (origKey) process.env.WANDB_API_KEY = origKey;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dashboard URL — null before init
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Dashboard URL before init ---');

  {
    const mlflow = new MLFlowClient('http://localhost:5000');
    assert(mlflow.getDashboardUrl() === null, 'MLFlow URL null before init');

    const wandb = new WandbClient('https://api.wandb.ai', 'k', 'e', 'p');
    assert(wandb.getDashboardUrl() === null, 'W&B URL null before init');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Circuit Breaker — Integration with Client
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n--- Circuit Breaker: Integration with Client ---');

  {
    const breaker = new CircuitBreaker(5, 300_000);
    mockFetch([
      { ok: true, status: 200, body: { experiment_id: 'e1' } },
      { ok: true, status: 200, body: { run: { info: { run_id: 'r1' } } } },
    ]);

    const client = new MLFlowClient('http://localhost:5000', breaker);
    await client.init({
      name: 'test',
      targetFiles: ['a.py'],
      evalCommand: 'cmd',
    });

    // Now fail fetch 5 times via logExperiment
    mockFetchError('Server down');
    for (let i = 0; i < 5; i++) {
      await client.logExperiment(makeResult(), i);
    }

    assert(breaker.isOpen, 'circuit breaker opens after 5 failed logExperiment calls');
    assertEq(breaker.state.failureCount, 5, 'failure count tracks across logExperiment calls');

    // Next logExperiment should be a no-op (breaker blocks, catch swallows)
    let threw = false;
    try {
      await client.logExperiment(makeResult(), 99);
    } catch {
      threw = true;
    }
    assert(!threw, 'logExperiment with open breaker does not throw');

    restoreFetch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════════════════

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed ✓');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
