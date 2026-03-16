/**
 * Hypothesis Integration Test — End-to-End Composition Proof (R049)
 *
 * Proves: scaffold generation → parser roundtrip → prompt builders with real data →
 * state machine cycling → eval execution → JSONL synchronization →
 * multi-hypothesis transitions.
 *
 * Does NOT call dispatchNextUnit (needs full runtime context). Instead composes
 * the sub-components directly.
 */

import { strict as assert } from 'node:assert';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  existsSync, copyFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── Imports under test ──────────────────────────────────────────────────────

import { generateNightShiftScaffold } from '../nightshift-interview.js';
import { parseRoadmapSlices } from '../roadmap-slices.js';
import { parsePlan } from '../files.js';
import { parseCampaignConfig, countExperiments } from '../state.js';
import {
  createInitialHypothesisState,
  writeHypothesisState,
  readHypothesisState,
  advanceHypothesisPhase,
} from '../hypothesis-state.js';
import {
  buildResearchHypothesisPrompt,
  buildPlanExperimentPrompt,
  buildExecuteExperimentPrompt,
  buildVerifyExperimentPrompt,
} from '../auto.js';
import { runEval, appendExperimentLog } from '../eval-runner.js';

import type { NightShiftInterviewResult } from '../nightshift-interview.js';
import type { ExperimentResult } from '../types.js';

// ─── Test harness ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

function assertInc(condition: boolean, msg: string): void {
  if (condition) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function gitInit(dir: string): void {
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email test@example.com', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name Test', { cwd: dir, stdio: 'ignore' });
}

// ─── Shared scaffold config ─────────────────────────────────────────────────

const KARPATHY_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'examples', 'karpathy-smoke');
const EVAL_COMMAND = `python3 ${join(KARPATHY_DIR, 'eval.py')}`;

const scaffoldConfig: NightShiftInterviewResult = {
  targetFiles: ['train.py'],
  evalCommand: EVAL_COMMAND,
  metrics: [
    { name: 'val_bpb', direction: 'min', weight: 1.0 },
    { name: 'train_loss', direction: 'min', weight: 0.5 },
  ],
  hypothesisCount: 2,
  experimentsPerHypothesis: 3,
};

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: Scaffold → Parser roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

async function scaffoldParserGroup(): Promise<string> {
  console.log('\n=== Scaffold → Parser roundtrip ===');

  const base = freshTmpDir('hyp-integ-scaffold-');

  // Generate scaffold
  test('scaffold generates without error', () => {
    generateNightShiftScaffold(base, scaffoldConfig);
  });

  // Check roadmap file exists and parse it
  const roadmapPath = join(base, '.gsd', 'milestones', 'M001', 'M001-ROADMAP.md');
  test('roadmap file exists after scaffold', () => {
    assert.ok(existsSync(roadmapPath));
  });

  const roadmapContent = readFileSync(roadmapPath, 'utf-8');
  const slices = parseRoadmapSlices(roadmapContent);

  assertInc(slices.length === 2, `parseRoadmapSlices returns 2 slices (got ${slices.length})`);
  assertInc(slices[0]?.id === 'S01', `first slice id is S01 (got ${slices[0]?.id})`);
  assertInc(slices[1]?.id === 'S02', `second slice id is S02 (got ${slices[1]?.id})`);

  // Parse each slice plan
  for (let i = 1; i <= 2; i++) {
    const sid = `S0${i}`;
    const planPath = join(base, '.gsd', 'milestones', 'M001', 'slices', sid, `${sid}-PLAN.md`);

    test(`slice plan ${sid} exists`, () => {
      assert.ok(existsSync(planPath));
    });

    const planContent = readFileSync(planPath, 'utf-8');
    const plan = parsePlan(planContent);

    assertInc(plan.id === sid, `parsePlan ${sid} id matches (got ${plan.id})`);
    assertInc(plan.tasks.length === scaffoldConfig.experimentsPerHypothesis,
      `parsePlan ${sid} has ${scaffoldConfig.experimentsPerHypothesis} tasks (got ${plan.tasks.length})`);
  }

  // Parse CAMPAIGN.json for S01
  const s01Dir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
  const campaign = parseCampaignConfig(s01Dir);

  test('parseCampaignConfig returns valid config', () => {
    assert.ok(campaign, 'campaign is non-null');
  });

  assertInc(campaign!.hypothesisMode === true, 'hypothesisMode is true');
  assertInc(campaign!.maxExperiments === 3, `maxExperiments is 3 (got ${campaign!.maxExperiments})`);
  assertInc(campaign!.evalConfig.metrics.length === 2, `metrics count is 2 (got ${campaign!.evalConfig.metrics.length})`);
  assertInc(campaign!.evalConfig.metrics[0]?.name === 'val_bpb', 'first metric is val_bpb');
  assertInc(campaign!.targetFiles[0] === 'train.py', 'targetFiles includes train.py');

  return base;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: Prompt builders with real scaffold data
// ═══════════════════════════════════════════════════════════════════════════════

async function promptBuilderGroup(basePath: string): Promise<void> {
  console.log('\n=== Prompt builders with real scaffold data ===');

  // Copy train.py to basePath so target file reading works
  copyFileSync(join(KARPATHY_DIR, 'train.py'), join(basePath, 'train.py'));

  const mid = 'M001';
  const sid = 'S01';

  // Research prompt
  const researchPrompt = await buildResearchHypothesisPrompt(mid, sid, basePath);
  assertInc(researchPrompt.length > 0, 'research prompt is non-empty');
  assertInc(researchPrompt.includes('val_bpb'), 'research prompt mentions val_bpb metric');

  // Plan prompt
  const planPrompt = await buildPlanExperimentPrompt(mid, sid, basePath, 1);
  assertInc(planPrompt.length > 0, 'plan prompt is non-empty');

  // Execute prompt — needs an experiment plan
  const execPrompt = await buildExecuteExperimentPrompt(
    mid, sid, basePath, 1, 'Test experiment plan: modify learning rate',
  );
  assertInc(execPrompt.length > 0, 'execute prompt is non-empty');

  // Verify prompt — needs current results
  const verifyPrompt = await buildVerifyExperimentPrompt(
    mid, sid, basePath, 1, 'Results: val_bpb=0.85, train_loss=0.78',
  );
  assertInc(verifyPrompt.length > 0, 'verify prompt is non-empty');

  // Naming compliance: no \bGSD\b or \blabrat\b in any prompt
  // Strip file-path occurrences (eval command embeds absolute paths containing repo name)
  // before checking for branding terms — paths aren't branding violations.
  const allPrompts = [researchPrompt, planPrompt, execPrompt, verifyPrompt];
  const pathPattern = /\/[^\s`]+/g;
  const gsdRegex = /\bGSD\b/;
  const labratRegex = /\blabrat\b/;

  for (const [i, prompt] of allPrompts.entries()) {
    const labels = ['research', 'plan', 'execute', 'verify'];
    const stripped = prompt.replace(pathPattern, '<PATH>');
    assertInc(!gsdRegex.test(stripped), `${labels[i]} prompt has no \\bGSD\\b`);
    assertInc(!labratRegex.test(stripped), `${labels[i]} prompt has no \\blabrat\\b`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: State machine cycling
// ═══════════════════════════════════════════════════════════════════════════════

function stateMachineCyclingGroup(): void {
  console.log('\n=== State machine cycling ===');

  const sliceDir = freshTmpDir('hyp-integ-state-');

  // Create initial state
  const initial = createInitialHypothesisState();
  writeHypothesisState(sliceDir, initial);

  assertInc(initial.subPhase === 'research', 'initial subPhase is research');
  assertInc(initial.experimentNumber === 1, 'initial experimentNumber is 1');

  // Advance research → plan
  const afterResearch = advanceHypothesisPhase(sliceDir, 'research');
  assertInc(afterResearch !== null, 'research→plan returns non-null');
  assertInc(afterResearch!.subPhase === 'plan', `after research: subPhase is plan (got ${afterResearch!.subPhase})`);
  assertInc(afterResearch!.experimentNumber === 1, 'after research: experimentNumber still 1');

  // Advance plan → execute
  const afterPlan = advanceHypothesisPhase(sliceDir, 'plan');
  assertInc(afterPlan !== null, 'plan→execute returns non-null');
  assertInc(afterPlan!.subPhase === 'execute', `after plan: subPhase is execute (got ${afterPlan!.subPhase})`);

  // Advance execute → verify
  const afterExec = advanceHypothesisPhase(sliceDir, 'execute');
  assertInc(afterExec !== null, 'execute→verify returns non-null');
  assertInc(afterExec!.subPhase === 'verify', `after execute: subPhase is verify (got ${afterExec!.subPhase})`);

  // Advance verify with maxExperiments > current → plan (experiment 2)
  const afterVerify1 = advanceHypothesisPhase(sliceDir, 'verify', 3);
  assertInc(afterVerify1 !== null, 'verify→plan+1 returns non-null (maxExperiments=3)');
  assertInc(afterVerify1!.subPhase === 'plan', `after verify+1: subPhase is plan (got ${afterVerify1!.subPhase})`);
  assertInc(afterVerify1!.experimentNumber === 2, `after verify+1: experimentNumber is 2 (got ${afterVerify1!.experimentNumber})`);

  // Run through experiment 2: plan→execute→verify
  advanceHypothesisPhase(sliceDir, 'plan');
  advanceHypothesisPhase(sliceDir, 'execute');

  // Advance verify with maxExperiments = current experiment → done (null)
  const afterDone = advanceHypothesisPhase(sliceDir, 'verify', 2);
  assertInc(afterDone === null, 'verify→done returns null when maxExperiments=current');

  // Read persisted state and check completedPhases
  const finalState = readHypothesisState(sliceDir);
  assertInc(finalState !== null, 'final state is readable');
  assertInc(
    finalState!.completedPhases.includes('research'),
    'completedPhases includes research',
  );
  assertInc(
    finalState!.completedPhases.includes('done'),
    'completedPhases includes done',
  );

  rmSync(sliceDir, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Eval + JSONL
// ═══════════════════════════════════════════════════════════════════════════════

function evalAndJsonlGroup(): void {
  console.log('\n=== Eval + JSONL ===');

  const base = freshTmpDir('hyp-integ-eval-');

  // Init a real git repo
  gitInit(base);

  // Copy karpathy-smoke train.py as the target file
  copyFileSync(join(KARPATHY_DIR, 'train.py'), join(base, 'train.py'));

  // Commit the target file
  execSync('git add .', { cwd: base, stdio: 'ignore' });
  execSync("git commit -m 'initial target file'", { cwd: base, stdio: 'ignore' });

  // Create slice directory with CAMPAIGN.json
  const sliceDir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
  mkdirSync(sliceDir, { recursive: true });

  const campaignJson = {
    name: 'Integration eval test',
    targetFiles: ['train.py'],
    evalConfig: {
      command: EVAL_COMMAND,
      timeout: 30,
      metrics: [
        { name: 'val_bpb', direction: 'min', weight: 1.0 },
        { name: 'train_loss', direction: 'min', weight: 0.5 },
      ],
      runs: 1,
    },
    maxExperiments: 3,
    budgetPerExperiment: 1.0,
    hypothesisMode: true,
  };

  writeFileSync(join(sliceDir, 'CAMPAIGN.json'), JSON.stringify(campaignJson, null, 2) + '\n');

  // Run eval
  const evalResult = runEval(EVAL_COMMAND, 30, base);

  assertInc(evalResult.exitCode === 0, `eval exit code is 0 (got ${evalResult.exitCode})`);
  assertInc(evalResult.stdout.length > 0, 'eval stdout is non-empty');

  // Parse metrics from stdout
  let metrics: Record<string, number> = {};
  try {
    metrics = JSON.parse(evalResult.stdout.trim());
  } catch {
    // stdout may have multiple lines; parse the JSON line
    const lines = evalResult.stdout.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        metrics = JSON.parse(line);
        break;
      } catch { /* skip */ }
    }
  }

  assertInc(typeof metrics.val_bpb === 'number', `stdout contains val_bpb metric (${metrics.val_bpb})`);
  assertInc(typeof metrics.train_loss === 'number', `stdout contains train_loss metric (${metrics.train_loss})`);

  // Verify JSONL sync: append an experiment and count
  assertInc(countExperiments(sliceDir) === 0, 'JSONL starts at 0 experiments');

  const fakeResult: ExperimentResult = {
    id: 'exp-001',
    description: 'Test experiment for integration',
    metrics,
    decision: { decision: 'keep', reason: 'better than baseline' },
    duration: 1500,
    cost: 0.01,
    diff: 'train.py | 2 +-',
  };

  appendExperimentLog(sliceDir, fakeResult);
  assertInc(countExperiments(sliceDir) === 1, 'JSONL count is 1 after append');

  // Append a second to verify increment
  appendExperimentLog(sliceDir, { ...fakeResult, id: 'exp-002' });
  assertInc(countExperiments(sliceDir) === 2, 'JSONL count is 2 after second append');

  rmSync(base, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // Group 1: Scaffold → Parser roundtrip (also creates basePath for Group 2)
  const basePath = await scaffoldParserGroup();

  // Group 2: Prompt builders with real scaffold data
  await promptBuilderGroup(basePath);

  // Cleanup scaffold tmpdir
  rmSync(basePath, { recursive: true });

  // Group 3: State machine cycling
  stateMachineCyclingGroup();

  // Group 4: Eval + JSONL
  evalAndJsonlGroup();

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n✓ ${passed} passed, ✗ ${failed} failed (total ${passed + failed})`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Uncaught error:', err);
  process.exit(1);
});
