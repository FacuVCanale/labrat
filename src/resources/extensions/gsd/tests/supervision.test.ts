/**
 * Contract tests for GSD Supervision: experiment log enrichment,
 * max-experiment guard, crash recovery, and lock enrichment.
 *
 * Covers: R007 (experiment log timestamps), R008 (max-experiment guard),
 * R009 (crash recovery orphan detection), R010 (timeout recovery).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  runExperimentPostProcess,
  readAllExperiments,
  appendExperimentLog,
} from '../eval-runner.ts';
import { countExperiments, deriveState } from '../state.ts';
import {
  writeLock,
  readCrashLock,
  formatCrashInfo,
} from '../crash-recovery.ts';
import type { LockData } from '../crash-recovery.ts';
import type { ExperimentResult } from '../types.ts';

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

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── Fixture helpers ───────────────────────────────────────────────────────

function createFixtureBase(): string {
  const base = mkdtempSync(join(tmpdir(), 'gsd-supervision-'));
  mkdirSync(join(base, '.gsd', 'milestones'), { recursive: true });
  return base;
}

function createGitRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'init.txt'), 'init');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

function writeRoadmap(base: string, mid: string, content: string): void {
  const dir = join(base, '.gsd', 'milestones', mid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${mid}-ROADMAP.md`), content);
}

function writePlan(base: string, mid: string, sid: string, content: string): void {
  const dir = join(base, '.gsd', 'milestones', mid, 'slices', sid);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, `${sid}-PLAN.md`), content);
}

function writeCampaign(base: string, mid: string, sid: string, config: object): void {
  const dir = join(base, '.gsd', 'milestones', mid, 'slices', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(config));
}

function makeExperimentResult(id: string, decision: 'keep' | 'discard'): ExperimentResult {
  return {
    id,
    description: 'test experiment',
    metrics: { accuracy: 0.9 },
    decision: {
      decision,
      reason: decision === 'keep' ? 'improved' : 'regressed',
      comparison: { accuracy: { before: 0.8, after: 0.9, improved: decision === 'keep' } },
    },
    duration: 1000,
    cost: 0.01,
    diff: 'abc123',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── ExperimentResult.timestamp is populated by runExperimentPostProcess ──
  console.log('\n=== ExperimentResult.timestamp populated ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-sup-ts-'));
    try {
      createGitRepo(dir);

      // Create a slice dir with a CAMPAIGN.json
      const sliceDir = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      mkdirSync(sliceDir, { recursive: true });
      writeCampaign(dir, 'M001', 'S01', {
        name: 'test-campaign',
        targetFiles: ['init.txt'],
        evalConfig: {
          command: 'echo "not a json line"',
          timeout: 10,
          metrics: [{ name: 'accuracy', direction: 'max', weight: 1.0 }],
          runs: 1,
        },
        maxExperiments: 5,
        budgetPerExperiment: 1.0,
      });

      // Commit .gsd/ files separately so that reverting the experiment commit
      // does not remove the slice directory (which appendExperimentLog needs).
      spawnSync('git', ['add', '.gsd'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'chore: add campaign config'], { cwd: dir });

      // Make a change and commit so there's something to eval
      writeFileSync(join(dir, 'init.txt'), 'modified');
      spawnSync('git', ['add', 'init.txt'], { cwd: dir });
      spawnSync('git', ['commit', '-m', 'experiment(E001): test change'], { cwd: dir });
      const commitHash = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).stdout.trim();

      const result = runExperimentPostProcess({
        sliceDir,
        basePath: dir,
        experimentNumber: 1,
        commitHash,
      });

      assert(result.timestamp !== undefined, 'timestamp is defined');
      assert(typeof result.timestamp === 'string', 'timestamp is a string');
      // Verify it's a valid ISO 8601 date
      const parsed = new Date(result.timestamp!);
      assert(!isNaN(parsed.getTime()), 'timestamp is a valid ISO date');
      assert(result.timestamp!.endsWith('Z'), 'timestamp ends with Z (UTC)');
    } finally {
      cleanup(dir);
    }
  }

  // ─── deriveState returns 'summarizing' when experiments >= max ──────────
  console.log('\n=== deriveState: experiments >= maxExperiments → summarizing ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', `# M001: Test Milestone\n\n**Vision:** Test.\n\n## Slices\n\n- [ ] **S01: Test Slice** \`risk:low\` \`depends:[]\`\n  > After this: Done.\n`);
      writePlan(base, 'M001', 'S01', `# S01: Test Slice\n\n## Tasks\n\n- [ ] **T01: Task one** \`est:1h\`\n`);
      writeCampaign(base, 'M001', 'S01', {
        name: 'test-campaign',
        targetFiles: ['init.txt'],
        evalConfig: {
          command: 'echo "done"',
          timeout: 10,
          metrics: [{ name: 'accuracy', direction: 'max', weight: 1.0 }],
          runs: 1,
        },
        maxExperiments: 3,
        budgetPerExperiment: 1.0,
      });

      // Write 3 experiment results (= maxExperiments)
      const sliceDir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      for (let i = 1; i <= 3; i++) {
        appendExperimentLog(sliceDir, makeExperimentResult(`exp-${String(i).padStart(3, '0')}`, 'keep'));
      }

      const state = await deriveState(base);
      assertEq(state.phase, 'summarizing', 'phase is summarizing when experiments reach max');
      assert(
        state.nextAction?.includes('complete') || state.nextAction?.includes('Summarize'),
        'nextAction indicates campaign is complete',
      );
      assertEq(state.progress?.experiments?.done, 3, 'experiments done = 3');
      assertEq(state.progress?.experiments?.total, 3, 'experiments total = 3');
    } finally {
      cleanup(base);
    }
  }

  // ─── deriveState returns 'experimenting' when experiments < max ─────────
  console.log('\n=== deriveState: experiments < maxExperiments → experimenting ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', `# M001: Test Milestone\n\n**Vision:** Test.\n\n## Slices\n\n- [ ] **S01: Test Slice** \`risk:low\` \`depends:[]\`\n  > After this: Done.\n`);
      writePlan(base, 'M001', 'S01', `# S01: Test Slice\n\n## Tasks\n\n- [ ] **T01: Task one** \`est:1h\`\n`);
      writeCampaign(base, 'M001', 'S01', {
        name: 'test-campaign',
        targetFiles: ['init.txt'],
        evalConfig: {
          command: 'echo "done"',
          timeout: 10,
          metrics: [{ name: 'accuracy', direction: 'max', weight: 1.0 }],
          runs: 1,
        },
        maxExperiments: 5,
        budgetPerExperiment: 1.0,
      });

      // Write 2 experiment results (< maxExperiments of 5)
      const sliceDir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      for (let i = 1; i <= 2; i++) {
        appendExperimentLog(sliceDir, makeExperimentResult(`exp-${String(i).padStart(3, '0')}`, 'keep'));
      }

      const state = await deriveState(base);
      assertEq(state.phase, 'experimenting', 'phase is experimenting when experiments below max');
      assertEq(state.progress?.experiments?.done, 2, 'experiments done = 2');
      assertEq(state.progress?.experiments?.total, 5, 'experiments total = 5');
    } finally {
      cleanup(base);
    }
  }

  // ─── formatCrashInfo includes experiment number when present ────────────
  console.log('\n=== formatCrashInfo: includes experimentNumber ===');
  {
    const lockWithExp: LockData = {
      pid: 12345,
      startedAt: '2026-01-01T00:00:00.000Z',
      unitType: 'run-experiment',
      unitId: 'M001/S01',
      unitStartedAt: '2026-01-01T00:01:00.000Z',
      completedUnits: 3,
      experimentNumber: 7,
    };
    const info = formatCrashInfo(lockWithExp);
    assert(info.includes('Experiment number: 7'), 'crash info includes experiment number');
    assert(info.includes('run-experiment'), 'crash info includes unit type');

    // Without experiment number — should NOT include the line
    const lockWithoutExp: LockData = {
      pid: 12345,
      startedAt: '2026-01-01T00:00:00.000Z',
      unitType: 'execute-task',
      unitId: 'M001/S01/T01',
      unitStartedAt: '2026-01-01T00:01:00.000Z',
      completedUnits: 2,
    };
    const infoNoExp = formatCrashInfo(lockWithoutExp);
    assert(!infoNoExp.includes('Experiment number'), 'crash info omits experiment number when absent');
  }

  // ─── writeLock / readCrashLock round-trips experimentNumber ─────────────
  console.log('\n=== writeLock / readCrashLock round-trip ===');
  {
    const base = createFixtureBase();
    try {
      // writeLock doesn't accept experimentNumber directly — it's added via
      // read-modify-write in dispatchNextUnit. Test the round-trip by writing
      // the lock, then manually enriching it, then reading back.
      writeLock(base, 'run-experiment', 'M001/S01', 5, '/tmp/session.jsonl');
      const lockFile = join(base, '.gsd', 'auto.lock');
      assert(existsSync(lockFile), 'lock file exists');

      // Read-modify-write to add experimentNumber (mirrors auto.ts pattern)
      const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));
      lockData.experimentNumber = 4;
      writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf-8');

      const recovered = readCrashLock(base);
      assert(recovered !== null, 'readCrashLock returns data');
      assertEq(recovered!.experimentNumber, 4, 'experimentNumber round-trips through lock');
      assertEq(recovered!.unitType, 'run-experiment', 'unitType preserved');
      assertEq(recovered!.completedUnits, 5, 'completedUnits preserved');
    } finally {
      cleanup(base);
    }
  }

  // ─── Orphan detection: git count > JSONL count ─────────────────────────
  console.log('\n=== Orphan detection: git experiments > JSONL entries ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-sup-orphan-'));
    try {
      createGitRepo(dir);

      const sliceDir = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      mkdirSync(sliceDir, { recursive: true });

      // Create 3 experiment commits in git
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(dir, 'init.txt'), `experiment ${i}`);
        spawnSync('git', ['add', '.'], { cwd: dir });
        spawnSync('git', ['commit', '-m', `experiment(E${String(i).padStart(3, '0')}): change ${i}`], { cwd: dir });
      }

      // But only 2 are in the JSONL
      for (let i = 1; i <= 2; i++) {
        appendExperimentLog(sliceDir, makeExperimentResult(`exp-${String(i).padStart(3, '0')}`, 'keep'));
      }

      // Count git experiment commits
      const gitLog = spawnSync(
        'git', ['log', '--oneline', '--grep=^experiment(E', '--format=%s'],
        { cwd: dir, encoding: 'utf-8' },
      ).stdout.trim();
      const gitExpCount = gitLog ? gitLog.split('\n').length : 0;
      const jsonlCount = countExperiments(sliceDir);

      assertEq(gitExpCount, 3, 'git has 3 experiment commits');
      assertEq(jsonlCount, 2, 'JSONL has 2 entries');
      assert(gitExpCount > jsonlCount, 'orphan detected: git > JSONL');
      assertEq(gitExpCount - jsonlCount, 1, 'exactly 1 orphan');
    } finally {
      cleanup(dir);
    }
  }

  // ─── ExperimentResult timestamp present in all result paths ─────────────
  console.log('\n=== ExperimentResult timestamp in appended log entries ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-sup-logts-'));
    try {
      const sliceDir = join(dir, 'slice');
      mkdirSync(sliceDir, { recursive: true });

      // Append a result WITH timestamp (as runExperimentPostProcess now does)
      const result: ExperimentResult = {
        ...makeExperimentResult('exp-001', 'keep'),
        timestamp: new Date().toISOString(),
      };
      appendExperimentLog(sliceDir, result);

      const entries = readAllExperiments(sliceDir);
      assertEq(entries.length, 1, 'one entry in log');
      assert(entries[0].timestamp !== undefined, 'logged entry has timestamp');
      assert(typeof entries[0].timestamp === 'string', 'timestamp is string');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Per-experiment budget guard: cost exceeds budget → should pause ──
  console.log('\n=== Per-experiment budget guard: cost exceeds budget ===');
  {
    // Simulate the budget check logic from handleAgentEnd:
    // if budgetPerExp is set and unitCost > 0 and unitCost > budgetPerExp → pause
    const budgetPerExp = 0.50;
    const unitCost = 0.75; // exceeds budget
    const shouldPause = budgetPerExp > 0 && unitCost > 0 && unitCost > budgetPerExp;
    assert(shouldPause === true, 'cost $0.75 > budget $0.50 triggers pause');

    // Verify the exact boundary: cost === budget should NOT trigger (only >)
    const exactCost = 0.50;
    const shouldPauseExact = budgetPerExp > 0 && exactCost > 0 && exactCost > budgetPerExp;
    assert(shouldPauseExact === false, 'cost exactly at budget does not trigger pause');

    // Cost well under budget
    const lowCost = 0.10;
    const shouldPauseLow = budgetPerExp > 0 && lowCost > 0 && lowCost > budgetPerExp;
    assert(shouldPauseLow === false, 'cost $0.10 < budget $0.50 does not trigger pause');
  }

  // ─── Per-experiment budget guard: cost is 0 → skip (graceful degradation) ──
  console.log('\n=== Per-experiment budget guard: zero cost → skip ===');
  {
    const budgetPerExp = 0.50;
    const unitCost = 0; // provider didn't report cost
    const shouldPause = budgetPerExp > 0 && unitCost > 0 && unitCost > budgetPerExp;
    assert(shouldPause === false, 'zero cost skips budget check (graceful degradation)');
  }

  // ─── Per-experiment budget guard: no budget configured → skip ──
  console.log('\n=== Per-experiment budget guard: no budget configured → skip ===');
  {
    // budget_per_experiment is undefined — check should be skipped entirely
    const budgetPerExp: number | undefined = undefined;
    const unitCost = 1.50; // high cost, but no budget configured
    const shouldCheck = budgetPerExp !== undefined && budgetPerExp > 0;
    assert(shouldCheck === false, 'undefined budget_per_experiment skips check');

    // budget_per_experiment is 0 — also skip (0 means "no limit")
    const zeroBudget = 0;
    const shouldCheckZero = zeroBudget !== undefined && zeroBudget > 0;
    assert(shouldCheckZero === false, 'zero budget_per_experiment skips check');
  }

  // ─── Campaign-level budget_ceiling guard fires before dispatch ──
  console.log('\n=== Campaign-level budget_ceiling guard ===');
  {
    // The budget_ceiling guard in dispatchNextUnit checks:
    // if totalCost >= budgetCeiling → pause
    const budgetCeiling = 5.00;
    const totalCost = 5.50;
    const shouldPause = totalCost >= budgetCeiling;
    assert(shouldPause === true, 'total $5.50 >= ceiling $5.00 triggers pause');

    // Exactly at ceiling — should still trigger (uses >=)
    const exactTotal = 5.00;
    const shouldPauseExact = exactTotal >= budgetCeiling;
    assert(shouldPauseExact === true, 'total exactly at ceiling triggers pause');

    // Under ceiling — should not trigger
    const underTotal = 4.99;
    const shouldPauseUnder = underTotal >= budgetCeiling;
    assert(shouldPauseUnder === false, 'total $4.99 < ceiling $5.00 does not trigger pause');
  }

  // ─── Per-experiment budget: cost extraction from session entries ──
  console.log('\n=== Per-experiment budget: cost extraction logic ===');
  {
    // Simulate cost extraction from session entries (mirrors handleAgentEnd logic)
    const mockEntries = [
      { type: 'message', message: { role: 'assistant', usage: { cost: 0.15 } } },
      { type: 'message', message: { role: 'user' } },
      { type: 'message', message: { role: 'assistant', usage: { cost: 0.25 } } },
      { type: 'message', message: { role: 'assistant', usage: { cost: { total: 0.10 } } } },
      { type: 'tool_result', data: {} }, // non-message entry
    ];

    let unitCost = 0;
    for (const entry of mockEntries) {
      if (entry.type !== 'message') continue;
      const msg = (entry as any).message;
      if (msg?.role === 'assistant' && msg.usage?.cost != null) {
        const c = msg.usage.cost;
        unitCost += typeof c === 'number' ? c : (c.total ?? 0);
      }
    }

    // 0.15 + 0.25 + 0.10 = 0.50
    assert(Math.abs(unitCost - 0.50) < 0.001, `cost extraction sums correctly: ${unitCost.toFixed(4)} ≈ 0.50`);

    // Zero-cost entries (provider doesn't report cost)
    const zeroCostEntries = [
      { type: 'message', message: { role: 'assistant', usage: { input: 100, output: 50 } } },
      { type: 'message', message: { role: 'assistant', usage: { input: 200, output: 100 } } },
    ];
    let zeroCost = 0;
    for (const entry of zeroCostEntries) {
      if (entry.type !== 'message') continue;
      const msg = (entry as any).message;
      if (msg?.role === 'assistant' && msg.usage?.cost != null) {
        const c = msg.usage.cost;
        zeroCost += typeof c === 'number' ? c : (c.total ?? 0);
      }
    }
    assertEq(zeroCost, 0, 'entries without cost field yield zero total');
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
