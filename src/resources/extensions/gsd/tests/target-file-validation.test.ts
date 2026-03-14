/**
 * Contract tests for target file validation (T02).
 * Covers: validateTargetFiles standalone logic, pipeline integration via
 * runExperimentPostProcess (violation triggers revert without eval).
 * Uses real git repos for all tests.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { validateTargetFiles, runExperimentPostProcess } from '../eval-runner.ts';
import type { ExperimentResult, CampaignConfig } from '../types.ts';

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

/** Create a git repo with an initial commit, then a second commit touching specified files. */
function setupGitRepo(files: Record<string, string>, secondCommitFiles: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gsd-target-validation-'));
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

  // Initial commit with base files
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    const fileDir = join(dir, name.split('/').slice(0, -1).join('/'));
    if (fileDir !== dir && !existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    writeFileSync(filePath, content);
  }
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });

  // Second commit — modify/add files
  for (const [name, content] of Object.entries(secondCommitFiles)) {
    const filePath = join(dir, name);
    const fileDir = join(dir, name.split('/').slice(0, -1).join('/'));
    if (fileDir !== dir && !existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    writeFileSync(filePath, content);
  }
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'experiment changes'], { cwd: dir });

  return dir;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── validateTargetFiles: standalone tests ─────────────────────────────

  console.log('\n=== validateTargetFiles: commit touching only target files → valid ===');
  {
    const dir = setupGitRepo(
      { 'train.py': 'v1\n' },
      { 'train.py': 'v2\n' },
    );
    try {
      const result = validateTargetFiles(['train.py'], dir);
      assertEq(result.valid, true, 'valid when only target file modified');
      assertEq(result.violations.length, 0, 'no violations for in-scope change');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: commit touching extra file → invalid ===');
  {
    const dir = setupGitRepo(
      { 'train.py': 'v1\n', 'config.yaml': 'a: 1\n' },
      { 'train.py': 'v2\n', 'config.yaml': 'a: 2\n' },
    );
    try {
      const result = validateTargetFiles(['train.py'], dir);
      assertEq(result.valid, false, 'invalid when extra file modified');
      assertEq(result.violations.length, 1, 'one violation detected');
      assertEq(result.violations[0], 'config.yaml', 'violation is config.yaml');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: multiple violations ===');
  {
    const dir = setupGitRepo(
      { 'train.py': 'v1\n', 'utils.py': 'v1\n', 'README.md': 'v1\n' },
      { 'train.py': 'v2\n', 'utils.py': 'v2\n', 'README.md': 'v2\n' },
    );
    try {
      const result = validateTargetFiles(['train.py'], dir);
      assertEq(result.valid, false, 'invalid with multiple out-of-scope files');
      assertEq(result.violations.length, 2, 'two violations');
      assert(result.violations.includes('utils.py'), 'utils.py is a violation');
      assert(result.violations.includes('README.md'), 'README.md is a violation');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: subdirectory file — exact path match ===');
  {
    const dir = setupGitRepo(
      { 'src/train.py': 'v1\n' },
      { 'src/train.py': 'v2\n' },
    );
    try {
      // Target is 'src/train.py' — exact match required
      const result = validateTargetFiles(['src/train.py'], dir);
      assertEq(result.valid, true, 'valid with exact subdirectory path match');
      assertEq(result.violations.length, 0, 'no violations for exact subdir match');

      // Target is just 'train.py' — should NOT match 'src/train.py'
      const result2 = validateTargetFiles(['train.py'], dir);
      assertEq(result2.valid, false, 'invalid when subdirectory path does not exactly match target');
      assertEq(result2.violations[0], 'src/train.py', 'violation is the subdirectory file');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: multiple target files — all in scope ===');
  {
    const dir = setupGitRepo(
      { 'train.py': 'v1\n', 'eval.py': 'v1\n' },
      { 'train.py': 'v2\n', 'eval.py': 'v2\n' },
    );
    try {
      const result = validateTargetFiles(['train.py', 'eval.py'], dir);
      assertEq(result.valid, true, 'valid when all changed files are in target list');
      assertEq(result.violations.length, 0, 'empty violations list for clean commit');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: git failure (non-git dir) → safe default valid ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-target-validation-'));
    try {
      const result = validateTargetFiles(['train.py'], dir);
      assertEq(result.valid, true, 'returns valid on git failure (safe default)');
      assertEq(result.violations.length, 0, 'no violations on git failure');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== validateTargetFiles: first commit (no HEAD~1) → safe default valid ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-target-validation-'));
    spawnSync('git', ['init'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, 'train.py'), 'v1\n');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['commit', '-m', 'first'], { cwd: dir });
    try {
      const result = validateTargetFiles(['train.py'], dir);
      assertEq(result.valid, true, 'returns valid when only one commit exists');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Pipeline integration: runExperimentPostProcess with violations ────

  console.log('\n=== pipeline: target file violation → revert without running eval ===');
  {
    // Set up git repo where experiment modifies an extra file
    const dir = setupGitRepo(
      { 'train.py': 'v1\n', 'sneaky.py': 'original\n' },
      { 'train.py': 'v2\n', 'sneaky.py': 'modified\n' },
    );
    try {
      // Create a CAMPAIGN.json that declares only train.py as target
      // Eval command is 'echo SHOULD_NOT_RUN' — if eval runs, we'd see it
      const campaign: CampaignConfig = {
        name: 'test-campaign',
        targetFiles: ['train.py'],
        evalConfig: {
          command: 'echo "SHOULD_NOT_RUN" && echo \'{"score": 99}\'',
          timeout: 10,
          metrics: [{ name: 'score', direction: 'max', weight: 1.0 }],
          runs: 1,
        },
        maxExperiments: 10,
        budgetPerExperiment: 1.0,
      };
      writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(campaign, null, 2));

      // Get the commit hash before running
      const hashResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
      const commitHash = hashResult.stdout.trim();

      const result = runExperimentPostProcess({
        sliceDir: dir,
        basePath: dir,
        experimentNumber: 1,
        commitHash,
      });

      // Verify: discarded with violation reason
      assertEq(result.decision.decision, 'discard', 'experiment discarded on target file violation');
      assert(result.decision.reason.includes('target file violation'), 'reason mentions target file violation');
      assert(result.decision.reason.includes('sneaky.py'), 'reason lists the violating file');

      // Verify: metrics are empty (eval never ran)
      assertEq(Object.keys(result.metrics).length, 0, 'no metrics — eval did not run');

      // Verify: simplicityScore is attached (computed before revert)
      assert(result.simplicityScore !== undefined, 'simplicityScore attached to violation result');
      assert(typeof result.simplicityScore!.score === 'number', 'simplicityScore has numeric score');

      // Verify: commit was reverted (HEAD should have changed)
      const newHashResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
      const newHash = newHashResult.stdout.trim();
      assert(newHash !== commitHash, 'commit was reverted (HEAD changed)');

      // Verify: experiment was logged
      const logPath = join(dir, 'EXPERIMENT-LOG.jsonl');
      assert(existsSync(logPath), 'experiment log was written');
      const logContent = readFileSync(logPath, 'utf-8');
      const logEntry = JSON.parse(logContent.trim());
      assertEq(logEntry.decision.decision, 'discard', 'log entry shows discard');
      assert(logEntry.decision.reason.includes('target file violation'), 'log entry reason includes violation');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== pipeline: valid target files → eval runs normally ===');
  {
    // Set up git repo where experiment only modifies the target file
    const dir = setupGitRepo(
      { 'train.py': 'v1\n' },
      { 'train.py': 'v2\n' },
    );
    try {
      const campaign: CampaignConfig = {
        name: 'test-campaign',
        targetFiles: ['train.py'],
        evalConfig: {
          command: 'echo \'{"score": 42}\'',
          timeout: 10,
          metrics: [{ name: 'score', direction: 'max', weight: 1.0 }],
          runs: 1,
        },
        maxExperiments: 10,
        budgetPerExperiment: 1.0,
      };
      writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(campaign, null, 2));

      const hashResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
      const commitHash = hashResult.stdout.trim();

      const result = runExperimentPostProcess({
        sliceDir: dir,
        basePath: dir,
        experimentNumber: 1,
        commitHash,
      });

      // Eval should run — we should get metrics
      assertEq(result.decision.decision, 'keep', 'experiment kept when target files valid (first experiment)');
      assertEq(result.metrics.score, 42, 'eval ran and produced metrics');
      assert(!result.decision.reason.includes('target file violation'), 'no violation in reason');
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
