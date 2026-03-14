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
  const dir = join(tmpdir(), `plan-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// ─── Test Group: Command Registration ─────────────────────────────────────────

console.log('\n=== plan command: command registration ===');
{
  const commandsPath = join(process.cwd(), 'src/resources/extensions/gsd/commands.ts');
  const commandsSource = readFileSync(commandsPath, 'utf-8');

  // "plan" in subcommands array
  assert(
    commandsSource.includes('"plan"'),
    '"plan" appears in commands.ts subcommands array',
  );

  // Handler for plan
  assert(
    commandsSource.includes('trimmed === "plan"'),
    'plan handler case exists in commands.ts',
  );

  // showPlan import
  assert(
    commandsSource.includes('showPlan'),
    'showPlan is imported in commands.ts',
  );
}

// ─── Test Group: Prompt Template ──────────────────────────────────────────────

console.log('\n=== plan command: prompt template ===');
{
  const templatePath = join(process.cwd(), 'src/resources/extensions/gsd/prompts/plan-agenda.md');
  assert(existsSync(templatePath), 'plan-agenda.md template exists');

  const template = readFileSync(templatePath, 'utf-8');

  // Check all required template variables are present
  assert(template.includes('{{researchQuestion}}'), 'template has {{researchQuestion}} variable');
  assert(template.includes('{{campaignName}}'), 'template has {{campaignName}} variable');
  assert(template.includes('{{targetFileList}}'), 'template has {{targetFileList}} variable');
  assert(template.includes('{{metricDefinitions}}'), 'template has {{metricDefinitions}} variable');
  assert(template.includes('{{maxExperiments}}'), 'template has {{maxExperiments}} variable');
  assert(template.includes('{{existingContext}}'), 'template has {{existingContext}} variable');
  assert(template.includes('{{sliceDir}}'), 'template has {{sliceDir}} variable');

  // Check structural content
  assert(template.includes('AgendaConfig'), 'template references AgendaConfig schema');
  assert(template.includes('experimentsPerPhase'), 'template includes experimentsPerPhase in schema');
  assert(template.includes('experimentPlans'), 'template includes experimentPlans in schema');
  assert(template.includes('totalExperiments'), 'template includes totalExperiments in schema');
  assert(template.includes('ask_user_questions'), 'template instructs LLM to use ask_user_questions');
  assert(template.includes('CAMPAIGN.json'), 'template instructs writing to CAMPAIGN.json');
  assert(template.includes('Agenda written to CAMPAIGN.json'), 'template specifies exact completion message');
}

// ─── Test Group: Prompt Assembly (buildPlanPrompt) ────────────────────────────

console.log('\n=== plan command: prompt assembly via loadPrompt ===');
{
  // Test that loadPrompt with plan-agenda template and all variables produces valid output
  const { loadPrompt } = await import('../prompt-loader.ts');

  const result = loadPrompt('plan-agenda', {
    researchQuestion: 'What model architecture works best?',
    campaignName: 'Architecture Search',
    targetFileList: '- `src/model.ts`\n- `src/config.ts`',
    metricDefinitions: '- **accuracy** — direction: max, weight: 1.0',
    maxExperiments: '12',
    existingContext: '### Milestone Context\n\nBuilding a classifier.',
    sliceDir: '.gsd/milestones/M001/slices/S01',
  });

  assert(result.includes('Architecture Search'), 'assembled prompt includes campaign name');
  assert(result.includes('What model architecture works best?'), 'assembled prompt includes research question');
  assert(result.includes('src/model.ts'), 'assembled prompt includes target files');
  assert(result.includes('accuracy'), 'assembled prompt includes metric definitions');
  assert(result.includes('12'), 'assembled prompt includes max experiments');
  assert(result.includes('Building a classifier'), 'assembled prompt includes existing context');
  assert(result.includes('.gsd/milestones/M001/slices/S01'), 'assembled prompt includes slice dir path');
}

// ─── Test Group: Agenda Validation Integration ────────────────────────────────

console.log('\n=== plan command: agenda validation integration ===');
{
  const { parseAgenda } = await import('../agenda.ts');

  // A well-formed agenda from the plan flow should pass parseAgenda
  const validAgenda = makeValidAgenda();
  const result = parseAgenda(validAgenda, 10);
  assert(result !== null, 'valid plan-produced agenda passes parseAgenda');
  assertEqual(result?.phases.length, 2, 'parsed agenda has correct number of phases');
  assertEqual(result?.totalExperiments, 10, 'parsed agenda has correct totalExperiments');

  // Agenda with experiments exceeding max should fail
  const overBudgetPhases = [
    { name: 'A', dimension: 'd', experimentsPerPhase: 8, goal: 'g' },
    { name: 'B', dimension: 'd', experimentsPerPhase: 8, goal: 'g' },
  ];
  const overBudget = { ...makeValidAgenda(), totalExperiments: 16, phases: overBudgetPhases };
  const overResult = parseAgenda(overBudget, 10);
  assert(overResult === null, 'over-budget agenda rejected by parseAgenda');

  // Agenda with empty phases should fail
  const emptyPhases = { ...makeValidAgenda(), phases: [] };
  assert(parseAgenda(emptyPhases, 10) === null, 'empty phases agenda rejected');
}

// ─── Test Group: checkAutoStartAfterPlan Detection ────────────────────────────

console.log('\n=== plan command: auto-start bridge ===');
{
  const { parseCampaignConfig } = await import('../state.ts');

  // Test 1: CAMPAIGN.json without agenda does not trigger
  const tmpDir1 = makeTmpDir();
  writeCampaignJson(tmpDir1, makeValidCampaign());
  const campaign1 = parseCampaignConfig(tmpDir1);
  assert(campaign1 !== null, 'campaign without agenda parses successfully');
  assert(!campaign1!.agenda, 'campaign without agenda has no agenda field');

  // Test 2: CAMPAIGN.json with valid agenda triggers
  const tmpDir2 = makeTmpDir();
  writeCampaignJson(tmpDir2, makeValidCampaign({ agenda: makeValidAgenda() }));
  const campaign2 = parseCampaignConfig(tmpDir2);
  assert(campaign2 !== null, 'campaign with agenda parses successfully');
  assert(campaign2!.agenda !== undefined, 'campaign with agenda has agenda field');

  // Validate the agenda from the campaign
  const { parseAgenda: parseAg } = await import('../agenda.ts');
  const parsedAgenda = parseAg(campaign2!.agenda, campaign2!.maxExperiments);
  assert(parsedAgenda !== null, 'agenda from campaign passes parseAgenda validation');

  // Test 3: AGENDA-STATE.json initialization
  const { createInitialAgendaState, writeAgendaState, readAgendaState } = await import('../agenda.ts');
  const initialState = createInitialAgendaState(parsedAgenda!);
  writeAgendaState(tmpDir2, initialState);
  const readBack = readAgendaState(tmpDir2);
  assert(readBack !== null, 'AGENDA-STATE.json written and read back successfully');
  assertEqual(readBack!.currentPhaseIndex, 0, 'initial state starts at phase 0');
  assertEqual(readBack!.completedPhases.length, 0, 'initial state has no completed phases');
  assert(
    readBack!.experimentRanges['Phase 1: Exploration'] !== undefined,
    'initial state has experiment range for first phase',
  );

  // Cleanup
  rmSync(tmpDir1, { recursive: true, force: true });
  rmSync(tmpDir2, { recursive: true, force: true });
}

// ─── Test Group: guided-flow.ts exports ───────────────────────────────────────

console.log('\n=== plan command: guided-flow exports ===');
{
  const guidedFlowPath = join(process.cwd(), 'src/resources/extensions/gsd/guided-flow.ts');
  const guidedFlowSource = readFileSync(guidedFlowPath, 'utf-8');

  assert(guidedFlowSource.includes('export async function showPlan'), 'showPlan is exported from guided-flow.ts');
  assert(guidedFlowSource.includes('export async function buildPlanPrompt'), 'buildPlanPrompt is exported from guided-flow.ts');
  assert(guidedFlowSource.includes('export function checkAutoStartAfterPlan'), 'checkAutoStartAfterPlan is exported from guided-flow.ts');
  assert(guidedFlowSource.includes('pendingPlanAutoStart'), 'pendingPlanAutoStart state variable exists');
}

// ─── Test Group: index.ts wiring ──────────────────────────────────────────────

console.log('\n=== plan command: index.ts wiring ===');
{
  const indexPath = join(process.cwd(), 'src/resources/extensions/gsd/index.ts');
  const indexSource = readFileSync(indexPath, 'utf-8');

  assert(indexSource.includes('checkAutoStartAfterPlan'), 'checkAutoStartAfterPlan imported in index.ts');
  assert(
    indexSource.includes('checkAutoStartAfterPlan()'),
    'checkAutoStartAfterPlan() called in agent_end handler',
  );
}

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed ✓');
