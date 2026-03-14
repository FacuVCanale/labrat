/**
 * Contract tests for GSD Eval Runner.
 * Covers: metric parsing, median aggregation, composite scoring,
 * keep/discard decisions, experiment log I/O, subprocess execution,
 * and the orchestrator (runExperimentPostProcess).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { spawnSync } from 'node:child_process';

import {
  runEval,
  parseMetrics,
  aggregateMetrics,
  computeCompositeScore,
  makeKeepDiscardDecision,
  readBestMetrics,
  appendExperimentLog,
  extractDiffStat,
} from '../eval-runner.ts';

import type { MetricDefinition, ExperimentResult } from '../types.ts';

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

function assertClose(actual: number, expected: number, epsilon: number, message: string): void {
  if (Math.abs(actual - expected) < epsilon) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ~${expected}, got ${actual}`);
  }
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── parseMetrics ─────────────────────────────────────────────────────

  console.log('\n=== parseMetrics: clean JSON on last line ===');
  {
    const stdout = '{"latency": 45.2, "throughput": 1200}';
    const result = parseMetrics(stdout);
    assertEq(result.latency, 45.2, 'parses latency from clean JSON');
    assertEq(result.throughput, 1200, 'parses throughput from clean JSON');
  }

  console.log('\n=== parseMetrics: mixed output — JSON at bottom ===');
  {
    const stdout = [
      'Loading model...',
      'Progress: 50%',
      'Progress: 100%',
      'WARNING: GPU memory low',
      '{"latency_p99": 42.0, "throughput": 1500}',
    ].join('\n');
    const result = parseMetrics(stdout);
    assertEq(result.latency_p99, 42.0, 'parses latency from mixed output');
    assertEq(result.throughput, 1500, 'parses throughput from mixed output');
  }

  console.log('\n=== parseMetrics: no JSON in stdout ===');
  {
    const stdout = 'Just some text\nNo JSON here\nDone.';
    const result = parseMetrics(stdout);
    assertEq(Object.keys(result).length, 0, 'returns empty object when no JSON found');
  }

  console.log('\n=== parseMetrics: filters non-numeric values ===');
  {
    const stdout = '{"latency": 45.2, "status": "ok", "tags": ["fast"], "count": 100, "nested": {"x": 1}}';
    const result = parseMetrics(stdout);
    assertEq(result.latency, 45.2, 'keeps numeric latency');
    assertEq(result.count, 100, 'keeps numeric count');
    assert(result.status === undefined, 'filters string value');
    assert(result.tags === undefined, 'filters array value');
    assert(result.nested === undefined, 'filters object value');
  }

  console.log('\n=== parseMetrics: filters NaN and Infinity ===');
  {
    const stdout = '{"good": 42, "nan_val": "NaN", "inf": "Infinity"}';
    const result = parseMetrics(stdout);
    assertEq(result.good, 42, 'keeps finite number');
    // NaN and Infinity as strings won't be typeof number, so they're already filtered
    assert(Object.keys(result).length === 1, 'only one metric survives');
  }

  console.log('\n=== parseMetrics: scans bottom-up ===');
  {
    // Two valid JSON lines — should take the bottom one
    const stdout = [
      '{"latency": 100}',
      'some log output',
      '{"latency": 42}',
    ].join('\n');
    const result = parseMetrics(stdout);
    assertEq(result.latency, 42, 'takes bottom-most JSON line');
  }

  console.log('\n=== parseMetrics: ignores JSON arrays ===');
  {
    const stdout = '[1, 2, 3]\n{"score": 99}';
    const result = parseMetrics(stdout);
    assertEq(result.score, 99, 'skips array, finds object');
  }

  console.log('\n=== parseMetrics: empty stdout ===');
  {
    assertEq(Object.keys(parseMetrics('')).length, 0, 'empty string returns empty object');
  }

  // ─── aggregateMetrics ─────────────────────────────────────────────────

  console.log('\n=== aggregateMetrics: odd number of runs ===');
  {
    const runs = [
      { latency: 10, throughput: 100 },
      { latency: 30, throughput: 300 },
      { latency: 20, throughput: 200 },
    ];
    const result = aggregateMetrics(runs);
    assertEq(result.latency, 20, 'median of [10,20,30] is 20');
    assertEq(result.throughput, 200, 'median of [100,200,300] is 200');
  }

  console.log('\n=== aggregateMetrics: even number of runs ===');
  {
    const runs = [
      { latency: 10 },
      { latency: 20 },
      { latency: 30 },
      { latency: 40 },
    ];
    const result = aggregateMetrics(runs);
    assertEq(result.latency, 25, 'median of [10,20,30,40] is 25');
  }

  console.log('\n=== aggregateMetrics: single run ===');
  {
    const runs = [{ latency: 42 }];
    const result = aggregateMetrics(runs);
    assertEq(result.latency, 42, 'single run returns the value directly');
  }

  console.log('\n=== aggregateMetrics: all empty runs ===');
  {
    const runs = [{}, {}, {}];
    const result = aggregateMetrics(runs);
    assertEq(Object.keys(result).length, 0, 'all empty runs returns empty object');
  }

  console.log('\n=== aggregateMetrics: mixed — some runs missing metrics ===');
  {
    const runs = [
      { latency: 10, throughput: 100 },
      { latency: 20 },
      { latency: 30, throughput: 200 },
    ];
    const result = aggregateMetrics(runs);
    assertEq(result.latency, 20, 'median latency from 3 values');
    assertEq(result.throughput, 150, 'median throughput from 2 values (average of 100 and 200)');
  }

  console.log('\n=== aggregateMetrics: empty input array ===');
  {
    assertEq(Object.keys(aggregateMetrics([])).length, 0, 'empty array returns empty object');
  }

  // ─── computeCompositeScore ─────────────────────────────────────────────

  const singleMaxMetric: MetricDefinition[] = [
    { name: 'throughput', direction: 'max', weight: 1.0 },
  ];

  const singleMinMetric: MetricDefinition[] = [
    { name: 'latency', direction: 'min', weight: 1.0 },
  ];

  console.log('\n=== computeCompositeScore: single max metric — improvement ===');
  {
    const score = computeCompositeScore(
      { throughput: 1200 },
      { throughput: 1000 },
      singleMaxMetric,
    );
    assertClose(score, 0.2, 0.001, 'throughput 1000→1200 = 0.2 improvement');
  }

  console.log('\n=== computeCompositeScore: single max metric — regression ===');
  {
    const score = computeCompositeScore(
      { throughput: 800 },
      { throughput: 1000 },
      singleMaxMetric,
    );
    assertClose(score, -0.2, 0.001, 'throughput 1000→800 = -0.2 regression');
  }

  console.log('\n=== computeCompositeScore: single min metric — improvement ===');
  {
    const score = computeCompositeScore(
      { latency: 40 },
      { latency: 50 },
      singleMinMetric,
    );
    assertClose(score, 0.2, 0.001, 'latency 50→40 = 0.2 improvement (lower is better)');
  }

  console.log('\n=== computeCompositeScore: single min metric — regression ===');
  {
    const score = computeCompositeScore(
      { latency: 60 },
      { latency: 50 },
      singleMinMetric,
    );
    assertClose(score, -0.2, 0.001, 'latency 50→60 = -0.2 regression (higher is worse)');
  }

  console.log('\n=== computeCompositeScore: weighted multi-metric ===');
  {
    const defs: MetricDefinition[] = [
      { name: 'latency', direction: 'min', weight: 0.7 },
      { name: 'throughput', direction: 'max', weight: 0.3 },
    ];
    // latency: 50→40 = improvement of 0.2, weighted = 0.14
    // throughput: 1000→900 = regression of -0.1, weighted = -0.03
    // Total weighted = 0.14 + (-0.03) = 0.11, total weight = 1.0, score = 0.11
    const score = computeCompositeScore(
      { latency: 40, throughput: 900 },
      { latency: 50, throughput: 1000 },
      defs,
    );
    assertClose(score, 0.11, 0.001, 'weighted composite correctly balances improvement and regression');
  }

  console.log('\n=== computeCompositeScore: weight normalization ===');
  {
    // Weights don't sum to 1 — should still work (normalized at comparison time)
    const defs: MetricDefinition[] = [
      { name: 'a', direction: 'max', weight: 2 },
      { name: 'b', direction: 'max', weight: 3 },
    ];
    // a: 100→200 = 1.0 improvement, weighted = 2.0
    // b: 100→200 = 1.0 improvement, weighted = 3.0
    // total weighted = 5.0, total weight = 5.0, score = 1.0
    const score = computeCompositeScore(
      { a: 200, b: 200 },
      { a: 100, b: 100 },
      defs,
    );
    assertClose(score, 1.0, 0.001, 'non-unit weights are properly normalized');
  }

  console.log('\n=== computeCompositeScore: zero baseline guard ===');
  {
    const score = computeCompositeScore(
      { throughput: 100 },
      { throughput: 0 },
      singleMaxMetric,
    );
    // baseline is 0, divisor should be 1, improvement = (100 - 0) / 1 = 100
    assertClose(score, 100, 0.001, 'zero baseline uses 1 as divisor, not division by zero');
  }

  console.log('\n=== computeCompositeScore: zero total weight ===');
  {
    // No matching metrics between current and baseline
    const score = computeCompositeScore(
      { unrelated: 42 },
      { throughput: 100 },
      singleMaxMetric,
    );
    assertEq(score, 0, 'returns 0 when no metrics match');
  }

  console.log('\n=== computeCompositeScore: empty metric defs ===');
  {
    const score = computeCompositeScore(
      { throughput: 100 },
      { throughput: 100 },
      [],
    );
    assertEq(score, 0, 'returns 0 with empty metric definitions');
  }

  // ─── makeKeepDiscardDecision ──────────────────────────────────────────

  const metricDefs: MetricDefinition[] = [
    { name: 'latency', direction: 'min', weight: 0.7 },
    { name: 'throughput', direction: 'max', weight: 0.3 },
  ];

  console.log('\n=== makeKeepDiscardDecision: first experiment (null baseline) ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 50, throughput: 1000 },
      null,
      metricDefs,
    );
    assertEq(decision.decision, 'keep', 'first experiment is always kept');
    assert(decision.reason.includes('first experiment'), 'reason mentions first experiment');
    assert(decision.reason.includes('baseline'), 'reason mentions baseline');
  }

  console.log('\n=== makeKeepDiscardDecision: improvement ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 40, throughput: 1100 },
      { latency: 50, throughput: 1000 },
      metricDefs,
    );
    assertEq(decision.decision, 'keep', 'keeps when metrics improve');
    assert(decision.reason.includes('improvement'), 'reason mentions improvement');
    assert(decision.comparison.latency.improved, 'latency comparison shows improved');
    assert(decision.comparison.throughput.improved, 'throughput comparison shows improved');
  }

  console.log('\n=== makeKeepDiscardDecision: regression ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 60, throughput: 900 },
      { latency: 50, throughput: 1000 },
      metricDefs,
    );
    assertEq(decision.decision, 'discard', 'discards when metrics regress');
    assert(decision.reason.includes('regression'), 'reason mentions regression');
    assert(!decision.comparison.latency.improved, 'latency shows not improved');
    assert(!decision.comparison.throughput.improved, 'throughput shows not improved');
  }

  console.log('\n=== makeKeepDiscardDecision: no change (score = 0) ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 50, throughput: 1000 },
      { latency: 50, throughput: 1000 },
      metricDefs,
    );
    assertEq(decision.decision, 'discard', 'discards when no improvement (score = 0)');
  }

  // ─── readBestMetrics ──────────────────────────────────────────────────

  console.log('\n=== readBestMetrics: no log file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      assertEq(readBestMetrics(dir), null, 'returns null when no log file exists');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readBestMetrics: empty log file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), '');
      assertEq(readBestMetrics(dir), null, 'returns null for empty log file');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readBestMetrics: finds latest kept experiment ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const entries = [
        { id: 'exp-001', metrics: { latency: 100 }, decision: { decision: 'keep', reason: 'first', comparison: {} } },
        { id: 'exp-002', metrics: { latency: 90 }, decision: { decision: 'discard', reason: 'worse', comparison: {} } },
        { id: 'exp-003', metrics: { latency: 80 }, decision: { decision: 'keep', reason: 'better', comparison: {} } },
      ];
      writeFileSync(
        join(dir, 'EXPERIMENT-LOG.jsonl'),
        entries.map(e => JSON.stringify(e)).join('\n') + '\n',
      );
      const best = readBestMetrics(dir);
      assertEq(best?.latency, 80, 'returns metrics from latest kept experiment (exp-003)');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readBestMetrics: skips unparseable lines ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const content = [
        '{"id": "exp-001", "metrics": {"score": 42}, "decision": {"decision": "keep", "reason": "first", "comparison": {}}}',
        'this is not valid JSON {{{',
        '',
        '{"id": "exp-002", "metrics": {"score": 50}, "decision": {"decision": "keep", "reason": "better", "comparison": {}}}',
      ].join('\n');
      writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), content);
      const best = readBestMetrics(dir);
      assertEq(best?.score, 50, 'skips bad lines, finds exp-002');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readBestMetrics: all discarded → null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const entries = [
        { id: 'exp-001', metrics: { x: 1 }, decision: { decision: 'discard', reason: 'bad', comparison: {} } },
        { id: 'exp-002', metrics: { x: 2 }, decision: { decision: 'discard', reason: 'worse', comparison: {} } },
      ];
      writeFileSync(
        join(dir, 'EXPERIMENT-LOG.jsonl'),
        entries.map(e => JSON.stringify(e)).join('\n') + '\n',
      );
      assertEq(readBestMetrics(dir), null, 'returns null when all experiments discarded');
    } finally {
      cleanup(dir);
    }
  }

  // ─── appendExperimentLog ──────────────────────────────────────────────

  console.log('\n=== appendExperimentLog: creates file and appends ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const result1: ExperimentResult = {
        id: 'exp-001',
        description: 'test',
        metrics: { score: 42 },
        decision: { decision: 'keep', reason: 'first', comparison: {} },
        duration: 100,
        cost: 0,
        diff: 'abc123',
      };
      const result2: ExperimentResult = {
        id: 'exp-002',
        description: 'test2',
        metrics: { score: 50 },
        decision: { decision: 'keep', reason: 'better', comparison: {} },
        duration: 200,
        cost: 0,
        diff: 'def456',
      };

      appendExperimentLog(dir, result1);
      appendExperimentLog(dir, result2);

      const logPath = join(dir, 'EXPERIMENT-LOG.jsonl');
      assert(existsSync(logPath), 'log file created');

      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      assertEq(lines.length, 2, 'two log entries written');

      const parsed1 = JSON.parse(lines[0]);
      assertEq(parsed1.id, 'exp-001', 'first entry has correct id');
      const parsed2 = JSON.parse(lines[1]);
      assertEq(parsed2.id, 'exp-002', 'second entry has correct id');
    } finally {
      cleanup(dir);
    }
  }

  // ─── runEval ──────────────────────────────────────────────────────────

  console.log('\n=== runEval: successful command ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const result = runEval('echo "hello world"', 10, dir);
      assertEq(result.exitCode, 0, 'exit code 0 for successful command');
      assert(result.stdout.includes('hello world'), 'stdout captured');
      assertEq(result.timedOut, false, 'not timed out');
      assertEq(result.signal, null, 'no signal for normal exit');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== runEval: failing command ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const result = runEval('echo "error msg" >&2 && exit 1', 10, dir);
      assertEq(result.exitCode, 1, 'exit code 1 for failing command');
      assert(result.stderr.includes('error msg'), 'stderr captured');
      assertEq(result.timedOut, false, 'not timed out');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== runEval: timeout ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const result = runEval('sleep 30', 1, dir);
      assertEq(result.timedOut, true, 'detected timeout');
      assert(result.signal === 'SIGTERM' || result.signal === 'SIGKILL', 'signal is SIGTERM or SIGKILL');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== runEval: stderr capture ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-test-'));
    try {
      const result = runEval('echo "out" && echo "err" >&2', 10, dir);
      assert(result.stdout.includes('out'), 'stdout captured');
      assert(result.stderr.includes('err'), 'stderr captured');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Integration: parseMetrics + aggregateMetrics ─────────────────────

  console.log('\n=== integration: multi-run parse + aggregate ===');
  {
    const outputs = [
      'Run 1...\n{"latency": 10, "throughput": 100}',
      'Run 2...\n{"latency": 30, "throughput": 300}',
      'Run 3...\n{"latency": 20, "throughput": 200}',
    ];
    const runs = outputs.map(o => parseMetrics(o));
    const aggregated = aggregateMetrics(runs);
    assertEq(aggregated.latency, 20, 'median latency across 3 runs');
    assertEq(aggregated.throughput, 200, 'median throughput across 3 runs');
  }

  // ─── extractDiffStat ──────────────────────────────────────────────────

  console.log('\n=== extractDiffStat: returns diff-stat summary from git repo ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-diffstat-'));
    try {
      // Set up a git repo with two commits
      spawnSync('git', ['init'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'train.py'), 'print("hello")\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });

      // Second commit — modify the file
      writeFileSync(join(dir, 'train.py'), 'print("hello")\nprint("world")\nprint("!")\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'update train.py'], { cwd: dir });

      const description = extractDiffStat(dir);
      assert(description.includes('train.py'), 'description includes filename');
      assert(description.includes('|'), 'description includes pipe separator');
      assert(description !== 'eval post-process', 'description is not the fallback');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== extractDiffStat: multi-file diff ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-diffstat-'));
    try {
      spawnSync('git', ['init'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'a.py'), 'x = 1\n');
      writeFileSync(join(dir, 'b.py'), 'y = 2\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });

      // Modify both files
      writeFileSync(join(dir, 'a.py'), 'x = 10\nx = 20\n');
      writeFileSync(join(dir, 'b.py'), 'y = 20\ny = 30\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'update both'], { cwd: dir });

      const description = extractDiffStat(dir);
      assert(description.includes('a.py'), 'multi-file description includes a.py');
      assert(description.includes('b.py'), 'multi-file description includes b.py');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== extractDiffStat: fallback on first commit (no HEAD~1) ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-diffstat-'));
    try {
      spawnSync('git', ['init'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'file.txt'), 'hello\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'first'], { cwd: dir });

      const description = extractDiffStat(dir);
      assertEq(description, 'eval post-process', 'falls back when only one commit exists');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== extractDiffStat: fallback on non-git directory ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-eval-diffstat-'));
    try {
      const description = extractDiffStat(dir);
      assertEq(description, 'eval post-process', 'falls back for non-git directory');
    } finally {
      cleanup(dir);
    }
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
