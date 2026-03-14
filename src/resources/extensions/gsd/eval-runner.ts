/**
 * GSD Eval Runner — Pure functions for the experiment evaluation pipeline.
 *
 * Pipeline: subprocess execution → JSON metric parsing → median aggregation
 *           → direction-aware weighted composite scoring → keep/discard decision
 *           → experiment log I/O → orchestrator with git operations.
 *
 * All functions are pure except runEval (subprocess), readBestMetrics/appendExperimentLog
 * (file I/O), and runExperimentPostProcess (orchestrator).
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ExperimentResult,
  MetricDefinition,
  KeepDiscardDecision,
} from './types.js';

import { revertExperiment } from './worktree.js';
import { parseCampaignConfig } from './state.js';

// ─── Subprocess Execution ───────────────────────────────────────────────────

export interface RunEvalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

/**
 * Run an eval command as a subprocess with timeout.
 * Distinguishes three outcomes: success (exit 0), crash (non-zero exit), timeout (signal-based).
 */
export function runEval(command: string, timeoutSecs: number, cwd: string): RunEvalResult {
  const result = spawnSync(command, {
    shell: true,
    timeout: timeoutSecs * 1000,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    cwd,
    encoding: 'utf-8',
  });

  const timedOut = result.signal === 'SIGTERM' || result.signal === 'SIGKILL';

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
    signal: result.signal,
    timedOut,
  };
}

// ─── Metric Parsing ─────────────────────────────────────────────────────────

/**
 * Parse metrics from mixed stdout by scanning lines bottom-up.
 * Takes the first (bottom-most) line that parses as a JSON object,
 * filters to entries with finite numeric values only.
 * Returns empty object if no valid JSON found.
 */
export function parseMetrics(stdout: string): Record<string, number> {
  const lines = stdout.split('\n');

  // Scan bottom-up for the first valid JSON object
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      // Must be a plain object (not array, not null)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        continue;
      }

      // Filter to numeric-only values
      const metrics: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && isFinite(value)) {
          metrics[key] = value;
        }
      }
      return metrics;
    } catch {
      // Not valid JSON, try the next line up
      continue;
    }
  }

  return {};
}

// ─── Median Aggregation ─────────────────────────────────────────────────────

/**
 * Aggregate multiple eval runs by computing the median for each metric.
 * Skips empty runs. Returns empty object if no valid runs have metrics.
 * Median: middle value for odd count, average of two middle values for even.
 */
export function aggregateMetrics(runs: Record<string, number>[]): Record<string, number> {
  // Collect all metric names across all runs
  const metricNames = new Set<string>();
  const validRuns = runs.filter(r => Object.keys(r).length > 0);

  if (validRuns.length === 0) return {};

  for (const run of validRuns) {
    for (const name of Object.keys(run)) {
      metricNames.add(name);
    }
  }

  const result: Record<string, number> = {};

  for (const name of metricNames) {
    const values = validRuns
      .filter(r => name in r)
      .map(r => r[name])
      .sort((a, b) => a - b);

    if (values.length === 0) continue;

    if (values.length % 2 === 1) {
      // Odd count — take middle value
      result[name] = values[Math.floor(values.length / 2)];
    } else {
      // Even count — average of two middle values
      const mid = values.length / 2;
      result[name] = (values[mid - 1] + values[mid]) / 2;
    }
  }

  return result;
}

// ─── Composite Scoring ──────────────────────────────────────────────────────

/**
 * Compute a direction-aware weighted composite score.
 * Normalizes weights at comparison time — config weights need not sum to 1.0.
 * Guards against division by zero when baseline metric is 0 (uses 1 as divisor).
 *
 * For each MetricDefinition:
 *   direction 'max': improvement = (current - baseline) / (|baseline| || 1)
 *   direction 'min': improvement = (baseline - current) / (|baseline| || 1)
 *
 * Returns the weighted average of improvements. Returns 0 if total weight is 0.
 */
export function computeCompositeScore(
  metrics: Record<string, number>,
  baseline: Record<string, number>,
  metricDefs: MetricDefinition[],
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const def of metricDefs) {
    const current = metrics[def.name];
    const base = baseline[def.name];

    // Skip metrics not present in both current and baseline
    if (current === undefined || base === undefined) continue;

    const divisor = Math.abs(base) || 1;
    const improvement = def.direction === 'max'
      ? (current - base) / divisor
      : (base - current) / divisor;

    weightedSum += improvement * def.weight;
    totalWeight += def.weight;
  }

  if (totalWeight === 0) return 0;

  return weightedSum / totalWeight;
}

// ─── Keep/Discard Decision ──────────────────────────────────────────────────

/**
 * Make a keep/discard decision based on current metrics vs baseline.
 * If baseline is null (first experiment), always keep if eval succeeded.
 * Otherwise, compute composite score: > 0 → keep, <= 0 → discard.
 * Includes per-metric comparison in the decision.
 */
export function makeKeepDiscardDecision(
  current: Record<string, number>,
  baseline: Record<string, number> | null,
  metricDefs: MetricDefinition[],
): KeepDiscardDecision {
  // First experiment — no baseline to compare against
  if (baseline === null) {
    const comparison: Record<string, { before: number; after: number; improved: boolean }> = {};
    for (const [key, value] of Object.entries(current)) {
      comparison[key] = { before: 0, after: value, improved: true };
    }
    return {
      decision: 'keep',
      reason: 'first experiment — establishes baseline',
      comparison,
    };
  }

  const score = computeCompositeScore(current, baseline, metricDefs);

  // Build per-metric comparison
  const comparison: Record<string, { before: number; after: number; improved: boolean }> = {};
  for (const def of metricDefs) {
    const cur = current[def.name];
    const base = baseline[def.name];
    if (cur === undefined || base === undefined) continue;

    const improved = def.direction === 'max' ? cur > base : cur < base;
    comparison[def.name] = { before: base, after: cur, improved };
  }

  if (score > 0) {
    return {
      decision: 'keep',
      reason: `composite score ${score.toFixed(4)} > 0 — improvement`,
      comparison,
    };
  }

  // Build regression summary for discard reason
  const regressions = Object.entries(comparison)
    .filter(([, v]) => !v.improved)
    .map(([name, v]) => `${name}: ${v.before} → ${v.after}`);

  return {
    decision: 'discard',
    reason: `composite score ${score.toFixed(4)} <= 0 — regression${regressions.length > 0 ? ': ' + regressions.join(', ') : ''}`,
    comparison,
  };
}

// ─── Experiment Log I/O ─────────────────────────────────────────────────────

/**
 * Read the best metrics from the experiment log (latest kept experiment).
 * Parses EXPERIMENT-LOG.jsonl, skips unparseable lines gracefully.
 * Returns null if no kept experiments found.
 */
export function readBestMetrics(sliceDir: string): Record<string, number> | null {
  const logPath = join(sliceDir, 'EXPERIMENT-LOG.jsonl');
  if (!existsSync(logPath)) return null;

  let content: string;
  try {
    content = readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }

  let bestEntry: ExperimentResult | null = null;
  let bestExpNumber = -1;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed) as ExperimentResult;
      if (entry.decision?.decision !== 'keep') continue;

      // Extract experiment number from id (e.g. "exp-003" → 3)
      const match = entry.id?.match(/(\d+)/);
      const expNum = match ? parseInt(match[1], 10) : -1;

      if (expNum > bestExpNumber) {
        bestExpNumber = expNum;
        bestEntry = entry;
      }
    } catch {
      // Skip unparseable lines
      continue;
    }
  }

  return bestEntry?.metrics ?? null;
}

/**
 * Read all experiments from the experiment log (JSONL).
 * Parses each line, skips unparseable lines gracefully.
 * Returns entries in file order. Returns empty array if file is missing.
 */
export function readAllExperiments(sliceDir: string): ExperimentResult[] {
  const logPath = join(sliceDir, 'EXPERIMENT-LOG.jsonl');
  if (!existsSync(logPath)) return [];

  let content: string;
  try {
    content = readFileSync(logPath, 'utf-8');
  } catch {
    return [];
  }

  const results: ExperimentResult[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as ExperimentResult;
      results.push(entry);
    } catch {
      // Skip unparseable lines
      continue;
    }
  }
  return results;
}

/**
 * Compress experiment history into one-liner summaries for prompt context.
 * Newest-first ordering. Cap defaults to 20.
 * Format: `exp-003: ✓ kept — val_bpb=1.4200 (train.py: +5/-3)`
 *         `exp-002: ✗ discarded — regression (val_bpb=1.5500)`
 */
export function compressExperimentHistory(experiments: ExperimentResult[], cap: number = 20): string {
  if (experiments.length === 0) return '';

  // Newest-first: reverse a copy
  const sorted = [...experiments].reverse();
  const capped = sorted.slice(0, cap);

  const lines = capped.map(exp => {
    const kept = exp.decision?.decision === 'keep';
    const icon = kept ? '✓ kept' : '✗ discarded';

    // Format metrics to 4 decimal places
    const metricParts = Object.entries(exp.metrics ?? {})
      .map(([name, value]) => `${name}=${value.toFixed(4)}`)
      .join(', ');

    // Use description for change context; fall back to diff hash
    const description = exp.description && exp.description !== 'eval post-process'
      ? exp.description
      : (exp.diff ? `diff:${exp.diff.slice(0, 8)}` : '');

    const reason = !kept && exp.decision?.reason
      ? exp.decision.reason
      : '';

    // Build the line
    let line = `${exp.id}: ${icon}`;
    if (kept && metricParts) {
      line += ` — ${metricParts}`;
    } else if (!kept && reason) {
      line += ` — ${reason}`;
    }
    if (metricParts && !kept) {
      line += ` (${metricParts})`;
    }
    if (description) {
      line += ` (${description})`;
    }

    return line;
  });

  return lines.join('\n');
}

/**
 * Append an experiment result to the experiment log.
 * Uses appendFileSync for crash safety — each write is atomic to the OS.
 */
export function appendExperimentLog(sliceDir: string, result: ExperimentResult): void {
  const logPath = join(sliceDir, 'EXPERIMENT-LOG.jsonl');
  appendFileSync(logPath, JSON.stringify(result) + '\n');
}

// ─── Diff-Stat Summary ──────────────────────────────────────────────────

/**
 * Extract a concise diff-stat summary from git for the most recent commit.
 * Returns a one-liner like `"train.py | 8 ++++---"` or multi-file summary.
 * Falls back to `'eval post-process'` if git diff fails (e.g., first commit).
 */
export function extractDiffStat(basePath: string): string {
  try {
    const result = spawnSync('git', ['diff', '--stat', 'HEAD~1..HEAD'], {
      cwd: basePath,
      encoding: 'utf-8',
      timeout: 10_000,
    });

    if (result.status !== 0 || !result.stdout) {
      return 'eval post-process';
    }

    // git diff --stat output ends with a summary line like:
    //   " 2 files changed, 10 insertions(+), 3 deletions(-)"
    // File lines look like:
    //   " train.py | 8 ++++---"
    const lines = result.stdout.split('\n').filter(l => l.trim());
    if (lines.length === 0) return 'eval post-process';

    // Take only file lines (contain ' | '), skip the trailing summary
    const fileLines = lines
      .filter(l => l.includes(' | '))
      .map(l => l.trim());

    if (fileLines.length === 0) return 'eval post-process';

    return fileLines.join(', ');
  } catch {
    return 'eval post-process';
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run post-experiment evaluation: eval command → parse metrics → aggregate →
 * compare against baseline → keep/discard → git revert if discard → log result.
 *
 * Handles edge cases:
 *   - Missing campaign config → discard with reason
 *   - All eval runs fail → discard
 *   - Eval timeout → discard with "timed out" reason
 *   - No changes committed → handled gracefully
 */
export function runExperimentPostProcess(opts: {
  sliceDir: string;
  basePath: string;
  experimentNumber: number;
  commitHash: string;
}): ExperimentResult {
  const { sliceDir, basePath, experimentNumber, commitHash } = opts;
  const startTime = Date.now();
  const expId = `exp-${String(experimentNumber).padStart(3, '0')}`;

  // Extract diff-stat before any potential revert (revert would change HEAD)
  const diffStatDescription = extractDiffStat(basePath);

  // Read campaign config
  const config = parseCampaignConfig(sliceDir);
  if (!config) {
    const result: ExperimentResult = {
      id: expId,
      description: diffStatDescription,
      metrics: {},
      decision: {
        decision: 'discard',
        reason: 'missing or invalid campaign config',
        comparison: {},
      },
      duration: Date.now() - startTime,
      cost: 0,
      diff: commitHash,
      timestamp: new Date().toISOString(),
    };
    revertExperiment(basePath, expId, commitHash, 'missing campaign config');
    appendExperimentLog(sliceDir, result);
    return result;
  }

  const evalConfig = config.evalConfig;
  const numRuns = evalConfig.runs || 1;

  // Run eval command multiple times
  const runMetrics: Record<string, number>[] = [];
  let lastTimedOut = false;
  let lastStderr = '';

  for (let i = 0; i < numRuns; i++) {
    const evalResult = runEval(evalConfig.command, evalConfig.timeout, basePath);

    if (evalResult.timedOut) {
      lastTimedOut = true;
      lastStderr = evalResult.stderr;
      // Still try to parse metrics from whatever output we got
      const metrics = parseMetrics(evalResult.stdout);
      if (Object.keys(metrics).length > 0) {
        runMetrics.push(metrics);
      }
      continue;
    }

    if (evalResult.exitCode !== 0) {
      lastStderr = evalResult.stderr;
      // Non-zero exit — try to parse metrics anyway (some eval tools report metrics before failing)
      const metrics = parseMetrics(evalResult.stdout);
      if (Object.keys(metrics).length > 0) {
        runMetrics.push(metrics);
      }
      continue;
    }

    const metrics = parseMetrics(evalResult.stdout);
    runMetrics.push(metrics);
  }

  // Check if all runs failed
  if (runMetrics.length === 0) {
    const reason = lastTimedOut
      ? `eval timed out after ${evalConfig.timeout}s`
      : `all ${numRuns} eval run(s) failed — ${lastStderr.slice(0, 200)}`;

    const result: ExperimentResult = {
      id: expId,
      description: diffStatDescription,
      metrics: {},
      decision: {
        decision: 'discard',
        reason,
        comparison: {},
      },
      duration: Date.now() - startTime,
      cost: 0,
      diff: commitHash,
      timestamp: new Date().toISOString(),
    };
    revertExperiment(basePath, expId, commitHash, reason);
    appendExperimentLog(sliceDir, result);
    return result;
  }

  // Aggregate metrics across runs
  const aggregated = aggregateMetrics(runMetrics);

  // Read baseline (best metrics from prior kept experiments)
  const baseline = readBestMetrics(sliceDir);

  // Make keep/discard decision
  const decision = makeKeepDiscardDecision(aggregated, baseline, evalConfig.metrics);

  const result: ExperimentResult = {
    id: expId,
    description: diffStatDescription,
    metrics: aggregated,
    decision,
    duration: Date.now() - startTime,
    cost: 0,
    diff: commitHash,
    timestamp: new Date().toISOString(),
  };

  // If discard, revert the experiment commit
  if (decision.decision === 'discard') {
    revertExperiment(basePath, expId, commitHash, decision.reason);
  }

  // Log the result
  appendExperimentLog(sliceDir, result);

  return result;
}
