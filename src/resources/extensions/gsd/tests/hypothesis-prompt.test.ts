/**
 * Contract tests for hypothesis-native prompt templates.
 * Covers: research-hypothesis, plan-experiment, execute-experiment, verify-experiment.
 * Proves each template loads with its builder's variable set (loadPrompt throws on
 * undeclared {{var}} placeholders). Verifies content requirements and naming compliance.
 */

import { loadPrompt } from '../prompt-loader.ts';

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

function assertContains(text: string, needle: string, label: string): void {
  if (text.includes(needle)) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — expected to contain "${needle}"`);
  }
}

function assertNotMatch(text: string, pattern: RegExp, label: string): void {
  if (!pattern.test(text)) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — unexpected match for ${pattern}`);
  }
}

// ─── Variable sets matching what each builder produces ─────────────────────

const researchHypothesisVars: Record<string, string> = {
  milestoneId: 'M001',
  sliceId: 'S03',
  researchQuestion: 'Can we reduce val_bpb below 1.0?',
  campaignName: 'Test Campaign',
  targetFileList: '`train.py`',
  maxExperiments: '10',
  budgetPerExperiment: '1.00',
  metricDefinitions: '- **val_bpb**: direction=min, weight=1.0',
  targetFileSources: '### `train.py`\n\n```\nprint("hello")\n```',
  priorsContext: '_No prior knowledge provided._',
  sliceDir: '.gsd/milestones/M001/slices/S03',
};

const planExperimentVars: Record<string, string> = {
  experimentNumber: '2',
  milestoneId: 'M001',
  sliceId: 'S03',
  researchQuestion: 'Can we reduce val_bpb below 1.0?',
  campaignName: 'Test Campaign',
  targetFileList: '`train.py`',
  maxExperiments: '10',
  budgetPerExperiment: '1.00',
  phaseContext: '',
  steeringContext: '',
  metricDefinitions: '- **val_bpb**: direction=min, weight=1.0',
  targetFileSources: '### `train.py`\n\n```\nprint("hello")\n```',
  bestMetrics: '- **val_bpb:** 1.4200',
  experimentHistory: 'exp-001: ✓ kept — val_bpb=1.4200',
  researchFindings: '## Key Findings\nLearning rate scheduling improves convergence.',
  priorAnalysis: '_No prior experiment analysis available._',
};

const executeExperimentVars: Record<string, string> = {
  experimentNumber: '2',
  milestoneId: 'M001',
  sliceId: 'S03',
  researchQuestion: 'Can we reduce val_bpb below 1.0?',
  campaignName: 'Test Campaign',
  targetFileList: '`train.py`',
  maxExperiments: '10',
  budgetPerExperiment: '1.00',
  phaseContext: '',
  steeringContext: '',
  evalCommand: 'python eval.py',
  evalTimeout: '300',
  evalRuns: '1',
  metricDefinitions: '- **val_bpb**: direction=min, weight=1.0',
  targetFileSources: '### `train.py`\n\n```\nprint("hello")\n```',
  bestMetrics: '- **val_bpb:** 1.4200',
  experimentHistory: 'exp-001: ✓ kept — val_bpb=1.4200',
  researchFindings: '## Key Findings\nLearning rate scheduling improves convergence.',
  priorAnalysis: '_No prior experiment analysis available._',
  experimentPlan: '## Hypothesis\n\n**Change:** Add cosine annealing LR schedule\n\n**Rationale:** Research shows LR scheduling reduces val_bpb\n\n**Expected outcome:** val_bpb drops ~0.05\n\n**Refutation criteria:** val_bpb increases or stays flat',
};

const verifyExperimentVars: Record<string, string> = {
  experimentNumber: '2',
  milestoneId: 'M001',
  sliceId: 'S03',
  researchQuestion: 'Can we reduce val_bpb below 1.0?',
  campaignName: 'Test Campaign',
  targetFileList: '`train.py`',
  maxExperiments: '10',
  budgetPerExperiment: '1.00',
  metricDefinitions: '- **val_bpb**: direction=min, weight=1.0',
  experimentHistory: 'exp-001: ✓ kept — val_bpb=1.4200\nexp-002: ✓ kept — val_bpb=1.3700',
  researchFindings: '## Key Findings\nLearning rate scheduling improves convergence.',
  priorAnalysis: '_No prior experiment analysis available._',
  currentResults: 'val_bpb: 1.3700 (improved from 1.4200)',
  sliceDir: '.gsd/milestones/M001/slices/S03',
};

// ─── research-hypothesis template ──────────────────────────────────────────

console.log('\n── research-hypothesis: template loading ──');

{
  let prompt: string;
  try {
    prompt = loadPrompt('research-hypothesis', researchHypothesisVars);
    assert(prompt.length > 100, 'research-hypothesis loads and produces content');
  } catch (err) {
    failed++;
    console.error(`  FAIL: research-hypothesis template threw: ${err}`);
    prompt = '';
  }

  if (prompt) {
    console.log('── research-hypothesis: content assertions ──');
    assertContains(prompt, 'search-the-web', 'research-hypothesis contains search-the-web');
    assertContains(prompt, 'fetch_page', 'research-hypothesis contains fetch_page');
    assertContains(prompt, 'resolve_library', 'research-hypothesis contains resolve_library');
    assertContains(prompt, 'get_library_docs', 'research-hypothesis contains get_library_docs');
    assertContains(prompt, 'HYPOTHESIS-RESEARCH.md', 'research-hypothesis contains HYPOTHESIS-RESEARCH.md');
    assertContains(prompt, 'NEVER STOP', 'research-hypothesis contains NEVER STOP');
    assertContains(prompt, '3', 'research-hypothesis contains source count 3');
    assertContains(prompt, 'Campaign Overview', 'research-hypothesis contains Campaign Overview');
    assertContains(prompt, 'Target Files', 'research-hypothesis contains Target Files');
    assertContains(prompt, 'Instructions', 'research-hypothesis contains Instructions');
    assertContains(prompt, 'Can we reduce val_bpb below 1.0?', 'research-hypothesis substituted research question');
    assertContains(prompt, 'Prior Knowledge', 'research-hypothesis contains Prior Knowledge section');
    assertContains(prompt, 'research agent', 'research-hypothesis identifies role as research agent');
  }
}

// ─── plan-experiment template ──────────────────────────────────────────────

console.log('\n── plan-experiment: template loading ──');

{
  let prompt: string;
  try {
    prompt = loadPrompt('plan-experiment', planExperimentVars);
    assert(prompt.length > 100, 'plan-experiment loads and produces content');
  } catch (err) {
    failed++;
    console.error(`  FAIL: plan-experiment template threw: ${err}`);
    prompt = '';
  }

  if (prompt) {
    console.log('── plan-experiment: content assertions ──');
    assertContains(prompt, 'NEVER STOP', 'plan-experiment contains NEVER STOP');
    assertContains(prompt, 'hypothesis', 'plan-experiment contains hypothesis language');
    assertContains(prompt, 'Campaign Overview', 'plan-experiment contains Campaign Overview');
    assertContains(prompt, 'Best Metrics', 'plan-experiment contains Best Metrics');
    assertContains(prompt, 'Experiment History', 'plan-experiment contains Experiment History');
    assertContains(prompt, 'Research Findings', 'plan-experiment contains Research Findings');
    assertContains(prompt, 'Prior Experiment Analysis', 'plan-experiment contains Prior Experiment Analysis');
    assertContains(prompt, 'Instructions', 'plan-experiment contains Instructions');
    assertContains(prompt, 'planning agent', 'plan-experiment identifies role as planning agent');
    assertContains(prompt, 'refut', 'plan-experiment contains refutation criteria language');
    assertContains(prompt, 'One focused change', 'plan-experiment contains one-change discipline');
    assertContains(prompt, 'Can we reduce val_bpb below 1.0?', 'plan-experiment substituted research question');
  }
}

// ─── execute-experiment template ───────────────────────────────────────────

console.log('\n── execute-experiment: template loading ──');

{
  let prompt: string;
  try {
    prompt = loadPrompt('execute-experiment', executeExperimentVars);
    assert(prompt.length > 100, 'execute-experiment loads and produces content');
  } catch (err) {
    failed++;
    console.error(`  FAIL: execute-experiment template threw: ${err}`);
    prompt = '';
  }

  if (prompt) {
    console.log('── execute-experiment: content assertions ──');
    assertContains(prompt, 'ONLY modify the target files', 'execute-experiment contains safety boundary');
    assertContains(prompt, 'Do NOT run the eval command', 'execute-experiment contains eval-is-automatic');
    assertContains(prompt, 'NEVER STOP', 'execute-experiment contains NEVER STOP');
    assertContains(prompt, 'Campaign Overview', 'execute-experiment contains Campaign Overview');
    assertContains(prompt, 'Target Files', 'execute-experiment contains Target Files');
    assertContains(prompt, 'Best Metrics', 'execute-experiment contains Best Metrics');
    assertContains(prompt, 'Experiment History', 'execute-experiment contains Experiment History');
    assertContains(prompt, 'Research Findings', 'execute-experiment contains Research Findings');
    assertContains(prompt, 'Prior Experiment Analysis', 'execute-experiment contains Prior Experiment Analysis');
    assertContains(prompt, 'Experiment Plan', 'execute-experiment contains Experiment Plan section');
    assertContains(prompt, 'Instructions', 'execute-experiment contains Instructions');
    assertContains(prompt, 'Safety Boundaries', 'execute-experiment contains Safety Boundaries');
    assertContains(prompt, 'Evaluation Is Automatic', 'execute-experiment contains Evaluation Is Automatic');
    assertContains(prompt, 'python eval.py', 'execute-experiment substituted eval command');
    assertContains(prompt, 'ONE focused change', 'execute-experiment contains one-change discipline');
    assertContains(prompt, 'Can we reduce val_bpb below 1.0?', 'execute-experiment substituted research question');
  }
}

// ─── verify-experiment template ────────────────────────────────────────────

console.log('\n── verify-experiment: template loading ──');

{
  let prompt: string;
  try {
    prompt = loadPrompt('verify-experiment', verifyExperimentVars);
    assert(prompt.length > 100, 'verify-experiment loads and produces content');
  } catch (err) {
    failed++;
    console.error(`  FAIL: verify-experiment template threw: ${err}`);
    prompt = '';
  }

  if (prompt) {
    console.log('── verify-experiment: content assertions ──');
    assertContains(prompt, 'What Worked', 'verify-experiment contains What Worked');
    assertContains(prompt, "What Didn't", 'verify-experiment contains What Didn\'t');
    assertContains(prompt, 'Signals', 'verify-experiment contains Signals');
    assertContains(prompt, 'simpl', 'verify-experiment contains simplicity criterion language');
    assertContains(prompt, 'EXPERIMENT-', 'verify-experiment contains EXPERIMENT- reference');
    assertContains(prompt, 'NEVER STOP', 'verify-experiment contains NEVER STOP');
    assertContains(prompt, 'Campaign Overview', 'verify-experiment contains Campaign Overview');
    assertContains(prompt, 'Experiment History', 'verify-experiment contains Experiment History');
    assertContains(prompt, 'Research Findings', 'verify-experiment contains Research Findings');
    assertContains(prompt, 'Prior Experiment Analysis', 'verify-experiment contains Prior Experiment Analysis');
    assertContains(prompt, 'Current Experiment Results', 'verify-experiment contains Current Experiment Results');
    assertContains(prompt, 'Instructions', 'verify-experiment contains Instructions');
    assertContains(prompt, 'verification agent', 'verify-experiment identifies role as verification agent');
    assertContains(prompt, 'Analysis Requirements', 'verify-experiment contains Analysis Requirements');
    assertContains(prompt, 'Verification Checklist', 'verify-experiment contains Verification Checklist');
    assertContains(prompt, 'Can we reduce val_bpb below 1.0?', 'verify-experiment substituted research question');
  }
}

// ─── Edge cases: templates load with empty/placeholder optional context ────

console.log('\n── Edge cases: empty optional context ──');

{
  // research-hypothesis with empty priors
  try {
    const prompt = loadPrompt('research-hypothesis', {
      ...researchHypothesisVars,
      priorsContext: '',
    });
    assert(prompt.length > 100, 'research-hypothesis loads with empty priorsContext');
  } catch (err) {
    failed++;
    console.error(`  FAIL: research-hypothesis with empty priorsContext threw: ${err}`);
  }
}

{
  // plan-experiment with all optional context empty/placeholder
  try {
    const prompt = loadPrompt('plan-experiment', {
      ...planExperimentVars,
      researchFindings: '_No research findings available yet._',
      priorAnalysis: '_No prior experiment analysis available._',
      experimentHistory: '_No prior experiments — this is the first one._',
      bestMetrics: '_No baseline yet — this experiment establishes the first baseline._',
      phaseContext: '',
      steeringContext: '',
    });
    assert(prompt.length > 100, 'plan-experiment loads with all empty optional context');
  } catch (err) {
    failed++;
    console.error(`  FAIL: plan-experiment with empty optional context threw: ${err}`);
  }
}

{
  // execute-experiment with all optional context empty/placeholder
  try {
    const prompt = loadPrompt('execute-experiment', {
      ...executeExperimentVars,
      researchFindings: '_No research findings available yet._',
      priorAnalysis: '_No prior experiment analysis available._',
      experimentHistory: '_No prior experiments — this is the first one._',
      bestMetrics: '_No baseline yet — this experiment establishes the first baseline._',
      experimentPlan: '(no plan provided)',
      phaseContext: '',
      steeringContext: '',
    });
    assert(prompt.length > 100, 'execute-experiment loads with all empty optional context');
  } catch (err) {
    failed++;
    console.error(`  FAIL: execute-experiment with empty optional context threw: ${err}`);
  }
}

{
  // verify-experiment with all optional context empty/placeholder
  try {
    const prompt = loadPrompt('verify-experiment', {
      ...verifyExperimentVars,
      researchFindings: '_No research findings available yet._',
      priorAnalysis: '_No prior experiment analysis available._',
      experimentHistory: '_No prior experiments — this is the first one._',
      currentResults: '(no results yet)',
    });
    assert(prompt.length > 100, 'verify-experiment loads with all empty optional context');
  } catch (err) {
    failed++;
    console.error(`  FAIL: verify-experiment with empty optional context threw: ${err}`);
  }
}

// ─── Naming compliance: no GSD/labrat/Labrat in any template ───────────────

console.log('\n── Naming compliance ──');

{
  const templateNames = [
    'research-hypothesis',
    'plan-experiment',
    'execute-experiment',
    'verify-experiment',
  ] as const;

  const namingPattern = /\bGSD\b|\blabrat\b|\bLabrat\b/;

  for (const name of templateNames) {
    // Load with the appropriate vars to get the raw-ish content
    // (we just need the template text, vars won't introduce these words)
    let vars: Record<string, string>;
    switch (name) {
      case 'research-hypothesis':
        vars = researchHypothesisVars;
        break;
      case 'plan-experiment':
        vars = planExperimentVars;
        break;
      case 'execute-experiment':
        vars = executeExperimentVars;
        break;
      case 'verify-experiment':
        vars = verifyExperimentVars;
        break;
    }

    try {
      const prompt = loadPrompt(name, vars);
      assertNotMatch(prompt, namingPattern, `${name} naming compliance — no GSD/labrat/Labrat`);
    } catch (err) {
      failed++;
      console.error(`  FAIL: ${name} naming compliance check threw: ${err}`);
    }
  }
}

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`\n✅ ${passed} passed, ❌ ${failed} failed\n`);
if (failed > 0) process.exit(1);
