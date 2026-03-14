import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `steer-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCampaignJson(dir: string, campaign: Record<string, unknown>): void {
  writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(campaign, null, 2));
}

function makeValidCampaign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Campaign',
    researchQuestion: 'What approach maximizes accuracy?',
    targetFiles: ['src/model.ts', 'src/pipeline.ts'],
    evalConfig: {
      command: 'npm test',
      timeout: 60,
      metrics: [
        { name: 'accuracy', direction: 'max', weight: 1.0 },
        { name: 'latency', direction: 'min', weight: 0.5 },
      ],
      runs: 1,
    },
    maxExperiments: 10,
    budgetPerExperiment: 0.5,
    ...overrides,
  };
}

function makeValidAgenda(): Record<string, unknown> {
  return {
    researchQuestion: 'What approach maximizes accuracy?',
    totalExperiments: 10,
    phases: [
      {
        name: 'Phase 1: Exploration',
        dimension: 'approach',
        experimentsPerPhase: 5,
        goal: 'Find best approach',
        experimentPlans: [
          { description: 'Try approach A', hypothesis: 'A is best', targetFocus: 'src/model.ts' },
        ],
      },
      {
        name: 'Phase 2: Refinement',
        dimension: 'tuning',
        experimentsPerPhase: 5,
        goal: 'Tune the winning approach',
        experimentPlans: [
          { description: 'Tune params', hypothesis: 'Lower lr helps', targetFocus: 'src/model.ts' },
        ],
      },
    ],
  };
}

function writeExperimentLog(dir: string, experiments: Record<string, unknown>[]): void {
  const lines = experiments.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), lines + '\n');
}

function writeAgendaState(dir: string, state: Record<string, unknown>): void {
  writeFileSync(join(dir, 'AGENDA-STATE.json'), JSON.stringify(state, null, 2));
}

// ─── Test Group: Prompt Template ──────────────────────────────────────────────

console.log('\n=== steering command: prompt template ===');
{
  const templatePath = join(process.cwd(), 'src/resources/extensions/gsd/prompts/steer-campaign.md');
  assert(existsSync(templatePath), 'steer-campaign.md template exists');

  const template = readFileSync(templatePath, 'utf-8');

  // Check all required template variables are present
  assert(template.includes('{{campaignName}}'), 'template has {{campaignName}} variable');
  assert(template.includes('{{researchQuestion}}'), 'template has {{researchQuestion}} variable');
  assert(template.includes('{{targetFileList}}'), 'template has {{targetFileList}} variable');
  assert(template.includes('{{metricDefinitions}}'), 'template has {{metricDefinitions}} variable');
  assert(template.includes('{{maxExperiments}}'), 'template has {{maxExperiments}} variable');
  assert(template.includes('{{currentPhaseInfo}}'), 'template has {{currentPhaseInfo}} variable');
  assert(template.includes('{{recentExperiments}}'), 'template has {{recentExperiments}} variable');
  assert(template.includes('{{sliceDir}}'), 'template has {{sliceDir}} variable');

  // Check structural content — SteeringDirective schema
  assert(template.includes('SteeringDirective'), 'template references SteeringDirective');
  assert(template.includes('"refocus"') || template.includes('refocus'), 'template includes refocus directive type');
  assert(template.includes('"skip_phase"') || template.includes('skip_phase'), 'template includes skip_phase directive type');
  assert(template.includes('"stop"') || template.includes('stop'), 'template includes stop directive type');
  assert(template.includes('"type"'), 'template includes type field in schema');
  assert(template.includes('"message"'), 'template includes message field in schema');
  assert(template.includes('"timestamp"'), 'template includes timestamp field in schema');

  // Latency notice instruction
  assert(
    template.includes('Will take effect after the current experiment finishes'),
    'template instructs LLM to print latency notice',
  );

  // STEERING.json write instruction
  assert(template.includes('STEERING.json'), 'template instructs writing to STEERING.json');
}

// ─── Test Group: run-experiment.md template ───────────────────────────────────

console.log('\n=== steering command: run-experiment template ===');
{
  const templatePath = join(process.cwd(), 'src/resources/extensions/gsd/prompts/run-experiment.md');
  const template = readFileSync(templatePath, 'utf-8');

  assert(template.includes('{{steeringContext}}'), 'run-experiment.md contains {{steeringContext}} variable');
}

// ─── Test Group: Prompt Assembly (buildSteeringPrompt) ────────────────────────

console.log('\n=== steering command: prompt assembly ===');
{
  // We need a project-like directory structure for buildSteeringPrompt
  // It uses resolveSlicePath which expects basePath/.gsd/milestones/MID/slices/SID/
  const tmpBase = makeTmpDir();
  const sliceDir = join(tmpBase, '.gsd', 'milestones', 'M001', 'slices', 'S01');
  mkdirSync(sliceDir, { recursive: true });

  // Test: returns null on missing campaign config
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase);
    assertEqual(result, null, 'buildSteeringPrompt returns null on missing campaign config');
  }

  // Write a campaign config
  writeCampaignJson(sliceDir, makeValidCampaign());

  // Test: includes campaign name and research question
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase);
    assert(result !== null, 'buildSteeringPrompt returns non-null with valid campaign');
    assert(result!.includes('Test Campaign'), 'assembled prompt includes campaign name');
    assert(result!.includes('What approach maximizes accuracy?'), 'assembled prompt includes research question');
  }

  // Test: includes metric definitions
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(result.includes('accuracy'), 'assembled prompt includes accuracy metric');
    assert(result.includes('latency'), 'assembled prompt includes latency metric');
    assert(result.includes('direction'), 'assembled prompt includes metric direction');
  }

  // Test: includes target files
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(result.includes('src/model.ts'), 'assembled prompt includes target file model.ts');
    assert(result.includes('src/pipeline.ts'), 'assembled prompt includes target file pipeline.ts');
  }

  // Test: handles empty experiment log
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(result.includes('No experiments recorded yet'), 'assembled prompt shows no experiments message for empty log');
  }

  // Test: works without agenda (no phase info section)
  {
    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(!result.includes('Current Phase'), 'assembled prompt has no phase info without agenda');
  }

  // Test: includes recent experiment summary when experiments exist
  {
    writeExperimentLog(sliceDir, [
      { id: 'exp-001', description: 'Try A', metrics: { accuracy: 0.85, latency: 120 }, decision: 'keep', duration: 5000, cost: 0.1, diff: '+5-3' },
      { id: 'exp-002', description: 'Try B', metrics: { accuracy: 0.90, latency: 100 }, decision: 'keep', duration: 4000, cost: 0.1, diff: '+3-1' },
      { id: 'exp-003', description: 'Try C', metrics: { accuracy: 0.80, latency: 150 }, decision: 'discard', duration: 6000, cost: 0.1, diff: '+10-5' },
    ]);

    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(result.includes('exp-001'), 'assembled prompt includes experiment exp-001');
    assert(result.includes('exp-003'), 'assembled prompt includes experiment exp-003');
    assert(result.includes('Recent Experiments'), 'assembled prompt has Recent Experiments heading');
  }

  // Test: includes phase info when agenda exists
  {
    writeCampaignJson(sliceDir, makeValidCampaign({ agenda: makeValidAgenda() }));
    writeAgendaState(sliceDir, {
      version: 1,
      currentPhaseIndex: 0,
      phaseResults: {},
      experimentRanges: { 'Phase 1: Exploration': { start: 1, end: 5 } },
      completedPhases: [],
    });

    const { buildSteeringPrompt } = await import('../guided-flow.ts');
    const result = buildSteeringPrompt('M001', 'S01', tmpBase)!;
    assert(result.includes('Current Phase'), 'assembled prompt includes Current Phase heading with agenda');
    assert(result.includes('Phase 1: Exploration'), 'assembled prompt includes phase name');
    assert(result.includes('approach'), 'assembled prompt includes phase dimension');
    assert(result.includes('Find best approach'), 'assembled prompt includes phase goal');
  }

  // Cleanup
  rmSync(tmpBase, { recursive: true, force: true });
}

// ─── Test Group: Prompt Template Loading ──────────────────────────────────────

console.log('\n=== steering command: prompt template loading ===');
{
  const { loadPrompt } = await import('../prompt-loader.ts');

  const result = loadPrompt('steer-campaign', {
    campaignName: 'Architecture Search',
    researchQuestion: 'What model architecture works best?',
    targetFileList: '- `src/model.ts`',
    metricDefinitions: '- **accuracy** — direction: max, weight: 1.0',
    maxExperiments: '12',
    currentPhaseInfo: '### Current Phase\n\n**Phase 1/2: Exploration**',
    recentExperiments: '### Recent Experiments\n\n- **exp-001**: accuracy=0.9 → keep',
    sliceDir: '.gsd/milestones/M001/slices/S01',
  });

  assert(result.includes('Architecture Search'), 'loaded template includes campaign name');
  assert(result.includes('What model architecture works best?'), 'loaded template includes research question');
  assert(result.includes('src/model.ts'), 'loaded template includes target files');
  assert(result.includes('accuracy'), 'loaded template includes metric');
  assert(result.includes('12'), 'loaded template includes max experiments');
  assert(result.includes('Exploration'), 'loaded template includes phase info');
  assert(result.includes('exp-001'), 'loaded template includes recent experiments');
  assert(result.includes('.gsd/milestones/M001/slices/S01'), 'loaded template includes slice dir');
}

// ─── Test Group: guided-flow.ts exports ───────────────────────────────────────

console.log('\n=== steering command: guided-flow exports ===');
{
  const guidedFlowPath = join(process.cwd(), 'src/resources/extensions/gsd/guided-flow.ts');
  const guidedFlowSource = readFileSync(guidedFlowPath, 'utf-8');

  assert(guidedFlowSource.includes('export async function showSteering'), 'showSteering is exported from guided-flow.ts');
  assert(guidedFlowSource.includes('export function buildSteeringPrompt'), 'buildSteeringPrompt is exported from guided-flow.ts');

  // Routing: showDiscuss checks for experimenting phase
  assert(guidedFlowSource.includes('state.phase === "experimenting"'), 'showDiscuss checks for experimenting phase');
  assert(guidedFlowSource.includes('showSteering(ctx, pi, basePath)'), 'showDiscuss calls showSteering when experimenting');
}

// ─── Test Group: auto.ts wiring ───────────────────────────────────────────────

console.log('\n=== steering command: auto.ts wiring ===');
{
  const autoPath = join(process.cwd(), 'src/resources/extensions/gsd/auto.ts');
  const autoSource = readFileSync(autoPath, 'utf-8');

  // Import check
  assert(autoSource.includes('checkSteeringDirective'), 'checkSteeringDirective imported in auto.ts');
  assert(autoSource.includes('getSteeringPromptOverride'), 'getSteeringPromptOverride imported in auto.ts');
  assert(
    autoSource.includes('from "./steering.js"'),
    'steering imports come from ./steering.js',
  );

  // Wiring check: steering before phase boundary
  const steeringIdx = autoSource.indexOf('checkSteeringDirective(sliceDir, config)');
  const phaseIdx = autoSource.indexOf('checkAndAdvancePhase(sliceDir');
  assert(steeringIdx > 0, 'checkSteeringDirective call exists in auto.ts');
  assert(phaseIdx > 0, 'checkAndAdvancePhase call exists in auto.ts');
  assert(steeringIdx < phaseIdx, 'checkSteeringDirective is called BEFORE checkAndAdvancePhase');

  // Stop handling
  assert(autoSource.includes('steer?.stop'), 'auto.ts checks steer.stop flag');
  assert(autoSource.includes('stopAuto(ctx, pi)'), 'auto.ts calls stopAuto on stop directive');

  // steeringContext in buildExperimentPrompt
  assert(autoSource.includes('steeringContext: getSteeringPromptOverride(sliceDir)'), 'steeringContext passed to loadPrompt');

  // Line count (match wc -l behavior — trailing newline doesn't count)
  const lineCount = autoSource.trimEnd().split('\n').length;
  assert(lineCount <= 3275, `auto.ts has ${lineCount} lines (≤ 3275)`);
}

// ─── Test Group: commands.ts help text ────────────────────────────────────────

console.log('\n=== steering command: commands.ts help text ===');
{
  const commandsPath = join(process.cwd(), 'src/resources/extensions/gsd/commands.ts');
  const commandsSource = readFileSync(commandsPath, 'utf-8');

  assert(commandsSource.includes('steering'), 'commands.ts help text mentions steering');
  assert(commandsSource.includes('discuss'), 'commands.ts includes discuss subcommand');
}

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed ✓');
