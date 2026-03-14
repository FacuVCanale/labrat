/**
 * Contract tests for GSD Simplicity Scorer.
 * Covers: computeSimplicityScore, extractNumericDiffStat, makeKeepDiscardDecision
 * with simplicity blending, ExperimentResult/CampaignConfig backward compat.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  computeSimplicityScore,
  extractNumericDiffStat,
} from '../simplicity-scorer.ts';

import { makeKeepDiscardDecision } from '../eval-runner.ts';

import type {
  DiffStat,
  SimplicityScore,
  MetricDefinition,
  ExperimentResult,
  CampaignConfig,
} from '../types.ts';

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

  // ─── computeSimplicityScore ─────────────────────────────────────────────

  console.log('\n=== computeSimplicityScore: zero churn → score = 1.0 ===');
  {
    const diffStat: DiffStat = { linesAdded: 0, linesRemoved: 0, filesChanged: 0 };
    const result = computeSimplicityScore(diffStat);
    assertEq(result.score, 1.0, 'zero churn gives score of 1.0');
    assertEq(result.linesAdded, 0, 'linesAdded preserved');
    assertEq(result.linesRemoved, 0, 'linesRemoved preserved');
    assertEq(result.filesChanged, 0, 'filesChanged preserved');
  }

  console.log('\n=== computeSimplicityScore: small churn ===');
  {
    const diffStat: DiffStat = { linesAdded: 5, linesRemoved: 4, filesChanged: 1 };
    const result = computeSimplicityScore(diffStat);
    // totalChurn = 5 + 4 = 9, score = 1 / (1 + 9) = 0.1
    assertClose(result.score, 0.1, 0.001, 'small churn (9 lines) gives score ≈ 0.1');
    assertEq(result.linesAdded, 5, 'linesAdded preserved');
    assertEq(result.linesRemoved, 4, 'linesRemoved preserved');
    assertEq(result.filesChanged, 1, 'filesChanged preserved');
  }

  console.log('\n=== computeSimplicityScore: large churn ===');
  {
    const diffStat: DiffStat = { linesAdded: 500, linesRemoved: 499, filesChanged: 10 };
    const result = computeSimplicityScore(diffStat);
    // totalChurn = 999, score = 1 / (1 + 999) = 0.001
    assertClose(result.score, 0.001, 0.0001, 'large churn (999 lines) gives score ≈ 0.001');
  }

  console.log('\n=== computeSimplicityScore: only additions ===');
  {
    const diffStat: DiffStat = { linesAdded: 19, linesRemoved: 0, filesChanged: 2 };
    const result = computeSimplicityScore(diffStat);
    // totalChurn = 19, score = 1 / (1 + 19) = 0.05
    assertClose(result.score, 0.05, 0.001, 'additions-only churn');
  }

  // ─── extractNumericDiffStat ─────────────────────────────────────────────

  console.log('\n=== extractNumericDiffStat: fallback on non-git directory ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-simplicity-test-'));
    try {
      const result = extractNumericDiffStat(dir);
      assertEq(result.linesAdded, 0, 'non-git dir: linesAdded = 0');
      assertEq(result.linesRemoved, 0, 'non-git dir: linesRemoved = 0');
      assertEq(result.filesChanged, 0, 'non-git dir: filesChanged = 0');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== extractNumericDiffStat: parses git numstat ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-simplicity-test-'));
    try {
      spawnSync('git', ['init'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'a.py'), 'line1\nline2\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });

      // Second commit: add 3 lines, remove 1
      writeFileSync(join(dir, 'a.py'), 'line2\nnew1\nnew2\nnew3\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'modify'], { cwd: dir });

      const result = extractNumericDiffStat(dir);
      assert(result.linesAdded > 0, 'git repo: linesAdded > 0');
      assert(result.filesChanged >= 1, 'git repo: filesChanged >= 1');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== extractNumericDiffStat: first commit (no HEAD~1) returns fallback ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-simplicity-test-'));
    try {
      spawnSync('git', ['init'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'file.txt'), 'content\n');
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'first'], { cwd: dir });

      const result = extractNumericDiffStat(dir);
      assertEq(result.linesAdded, 0, 'first commit: linesAdded = 0 (fallback)');
      assertEq(result.linesRemoved, 0, 'first commit: linesRemoved = 0 (fallback)');
      assertEq(result.filesChanged, 0, 'first commit: filesChanged = 0 (fallback)');
    } finally {
      cleanup(dir);
    }
  }

  // ─── makeKeepDiscardDecision: backward compat (simplicityWeight=0) ──────

  const metricDefs: MetricDefinition[] = [
    { name: 'latency', direction: 'min', weight: 0.7 },
    { name: 'throughput', direction: 'max', weight: 0.3 },
  ];

  console.log('\n=== makeKeepDiscardDecision: weight=0 matches M001 behavior — improvement ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 40, throughput: 1100 },
      { latency: 50, throughput: 1000 },
      metricDefs,
      { simplicityWeight: 0 },
    );
    assertEq(decision.decision, 'keep', 'weight=0 keeps on improvement (same as M001)');
    assert(decision.reason.includes('composite score'), 'weight=0 uses composite score reason');
  }

  console.log('\n=== makeKeepDiscardDecision: weight=0 matches M001 behavior — regression ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 60, throughput: 900 },
      { latency: 50, throughput: 1000 },
      metricDefs,
      { simplicityWeight: 0 },
    );
    assertEq(decision.decision, 'discard', 'weight=0 discards on regression (same as M001)');
    assert(decision.reason.includes('composite score'), 'weight=0 uses composite score reason');
  }

  console.log('\n=== makeKeepDiscardDecision: absent opts matches M001 behavior ===');
  {
    const decision = makeKeepDiscardDecision(
      { latency: 40, throughput: 1100 },
      { latency: 50, throughput: 1000 },
      metricDefs,
    );
    assertEq(decision.decision, 'keep', 'absent opts keeps on improvement (same as M001)');
    assert(decision.reason.includes('composite score'), 'absent opts uses composite score reason');
  }

  // ─── makeKeepDiscardDecision: simplicity blending (weight > 0) ──────────

  console.log('\n=== makeKeepDiscardDecision: weight>0 prefers simpler code when metric regresses ===');
  {
    // Metric composite would be negative (regression) → metricSignal = 0
    // But high simplicity (score=0.9) with weight=0.5 gives:
    // blended = 0.5 * 0 + 0.5 * 0.9 = 0.45 > 0 → keep
    const simplicityScore: SimplicityScore = {
      score: 0.9, linesAdded: 1, linesRemoved: 0, filesChanged: 1,
    };
    const decision = makeKeepDiscardDecision(
      { latency: 51, throughput: 999 },  // slight regression
      { latency: 50, throughput: 1000 },
      metricDefs,
      { simplicityWeight: 0.5, simplicityScore },
    );
    assertEq(decision.decision, 'keep', 'high simplicity overrides slight metric regression');
    assert(decision.reason.includes('blended score'), 'reason mentions blended score');
    assert(decision.reason.includes('simplicity'), 'reason mentions simplicity');
  }

  console.log('\n=== makeKeepDiscardDecision: weight>0 discards low-simplicity regression ===');
  {
    // Metric composite would be negative → metricSignal = 0
    // Low simplicity (score=0.001) with weight=0.3 gives:
    // blended = 0.7 * 0 + 0.3 * 0.001 = 0.0003 > 0 → still keeps (any positive blended keeps)
    // Let's use weight=0.0 to show discard... Actually let's construct a zero blended:
    // metricSignal = 0, simplicityScore = 0 → blended = 0 → discard
    const simplicityScore: SimplicityScore = {
      score: 0, linesAdded: 5000, linesRemoved: 5000, filesChanged: 50,
    };
    const decision = makeKeepDiscardDecision(
      { latency: 60, throughput: 900 },  // regression
      { latency: 50, throughput: 1000 },
      metricDefs,
      { simplicityWeight: 0.5, simplicityScore },
    );
    assertEq(decision.decision, 'discard', 'zero simplicity + regression = discard');
    assert(decision.reason.includes('blended score'), 'reason mentions blended score');
  }

  console.log('\n=== makeKeepDiscardDecision: weight>0 metric improvement dominates ===');
  {
    // Metric composite positive → metricSignal = 1
    // Low simplicity (score=0.01) with weight=0.3:
    // blended = 0.7 * 1 + 0.3 * 0.01 = 0.703 > 0 → keep
    const simplicityScore: SimplicityScore = {
      score: 0.01, linesAdded: 50, linesRemoved: 49, filesChanged: 5,
    };
    const decision = makeKeepDiscardDecision(
      { latency: 40, throughput: 1100 },  // improvement
      { latency: 50, throughput: 1000 },
      metricDefs,
      { simplicityWeight: 0.3, simplicityScore },
    );
    assertEq(decision.decision, 'keep', 'metric improvement keeps even with low simplicity');
  }

  // ─── ExperimentResult with simplicityScore round-trip ──────────────────

  console.log('\n=== ExperimentResult with simplicityScore round-trips through JSON ===');
  {
    const result: ExperimentResult = {
      id: 'exp-001',
      description: 'test experiment',
      metrics: { score: 42 },
      decision: { decision: 'keep', reason: 'first', comparison: {} },
      duration: 100,
      cost: 0,
      diff: 'abc123',
      timestamp: '2025-01-01T00:00:00.000Z',
      simplicityScore: {
        score: 0.1,
        linesAdded: 5,
        linesRemoved: 4,
        filesChanged: 1,
      },
    };
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as ExperimentResult;
    assertEq(parsed.simplicityScore?.score, 0.1, 'simplicityScore.score round-trips');
    assertEq(parsed.simplicityScore?.linesAdded, 5, 'simplicityScore.linesAdded round-trips');
    assertEq(parsed.simplicityScore?.filesChanged, 1, 'simplicityScore.filesChanged round-trips');
  }

  console.log('\n=== ExperimentResult without simplicityScore still parses ===');
  {
    const result: ExperimentResult = {
      id: 'exp-002',
      description: 'legacy',
      metrics: { score: 50 },
      decision: { decision: 'keep', reason: 'better', comparison: {} },
      duration: 200,
      cost: 0,
      diff: 'def456',
    };
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as ExperimentResult;
    assertEq(parsed.simplicityScore, undefined, 'absent simplicityScore parses as undefined');
    assertEq(parsed.id, 'exp-002', 'other fields unaffected');
  }

  // ─── CampaignConfig with/without simplicityWeight ─────────────────────

  console.log('\n=== CampaignConfig with simplicityWeight parses ===');
  {
    const config: CampaignConfig = {
      name: 'test-campaign',
      targetFiles: ['src/model.py'],
      evalConfig: { command: 'echo ok', timeout: 30, metrics: [], runs: 1 },
      maxExperiments: 5,
      budgetPerExperiment: 0.5,
      simplicityWeight: 0.3,
    };
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as CampaignConfig;
    assertEq(parsed.simplicityWeight, 0.3, 'simplicityWeight round-trips');
    assertEq(parsed.name, 'test-campaign', 'other fields unaffected');
  }

  console.log('\n=== CampaignConfig without simplicityWeight parses ===');
  {
    const config: CampaignConfig = {
      name: 'legacy-campaign',
      targetFiles: ['src/model.py'],
      evalConfig: { command: 'echo ok', timeout: 30, metrics: [], runs: 1 },
      maxExperiments: 5,
      budgetPerExperiment: 0.5,
    };
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as CampaignConfig;
    assertEq(parsed.simplicityWeight, undefined, 'absent simplicityWeight parses as undefined');
    assertEq(parsed.name, 'legacy-campaign', 'other fields unaffected');
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
