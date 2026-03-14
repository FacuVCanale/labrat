/**
 * Contract tests for GSD Agenda Module.
 * Covers: parseAgenda, readAgendaState, writeAgendaState, createInitialAgendaState,
 * getCurrentPhase, advancePhase, shouldAdvancePhase, getPhaseContext,
 * getPhaseBestMetrics, getPhaseFilteredHistory, backward compatibility.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseAgenda,
  readAgendaState,
  writeAgendaState,
  createInitialAgendaState,
  getCurrentPhase,
  advancePhase,
  shouldAdvancePhase,
  getPhaseContext,
  getPhaseBestMetrics,
  getPhaseFilteredHistory,
} from '../agenda.ts';

import type {
  AgendaConfig,
  AgendaState,
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

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeValidAgendaRaw(): Record<string, unknown> {
  return {
    researchQuestion: 'What learning rate schedule maximizes accuracy?',
    totalExperiments: 10,
    phases: [
      {
        name: 'exploration',
        dimension: 'learning_rate',
        experimentsPerPhase: 5,
        goal: 'Find promising learning rate ranges',
        experimentPlans: [
          { description: 'Test 1e-3', hypothesis: 'Standard LR works', targetFocus: 'optimizer.py' },
        ],
      },
      {
        name: 'refinement',
        dimension: 'schedule',
        experimentsPerPhase: 5,
        goal: 'Optimize schedule within best range',
      },
    ],
  };
}

function makeValidConfig(): AgendaConfig {
  return parseAgenda(makeValidAgendaRaw()) as AgendaConfig;
}

function makeExperiments(count: number): ExperimentResult[] {
  const results: ExperimentResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push({
      id: `exp-${String(i).padStart(3, '0')}`,
      description: `Experiment ${i}`,
      metrics: { accuracy: 0.5 + i * 0.05, loss: 1.0 - i * 0.1 },
      decision: { decision: i % 2 === 0 ? 'keep' : 'discard', reason: 'test', comparison: {} },
      duration: 100,
      cost: 0.01,
      diff: `diff-${i}`,
      timestamp: new Date().toISOString(),
    });
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── parseAgenda: valid inputs ──────────────────────────────────────────

  console.log('\n=== parseAgenda: valid agenda parses successfully ===');
  {
    const result = parseAgenda(makeValidAgendaRaw());
    assert(result !== null, 'valid agenda returns non-null');
    assertEq(result!.phases.length, 2, 'two phases parsed');
    assertEq(result!.researchQuestion, 'What learning rate schedule maximizes accuracy?', 'research question preserved');
    assertEq(result!.totalExperiments, 10, 'totalExperiments preserved');
    assertEq(result!.phases[0].name, 'exploration', 'phase 1 name');
    assertEq(result!.phases[0].experimentsPerPhase, 5, 'phase 1 experimentsPerPhase');
    assertEq(result!.phases[1].name, 'refinement', 'phase 2 name');
  }

  console.log('\n=== parseAgenda: single phase agenda ===');
  {
    const raw = {
      researchQuestion: 'Single phase test',
      totalExperiments: 3,
      phases: [{ name: 'only-phase', dimension: 'x', experimentsPerPhase: 3, goal: 'test' }],
    };
    const result = parseAgenda(raw);
    assert(result !== null, 'single phase parses');
    assertEq(result!.phases.length, 1, 'one phase');
  }

  console.log('\n=== parseAgenda: experiment plans included ===');
  {
    const config = makeValidConfig();
    assert(config.phases[0].experimentPlans !== undefined, 'phase 1 has experiment plans');
    assertEq(config.phases[0].experimentPlans!.length, 1, 'phase 1 has 1 plan');
    assertEq(config.phases[0].experimentPlans![0].description, 'Test 1e-3', 'plan description');
    assertEq(config.phases[0].experimentPlans![0].hypothesis, 'Standard LR works', 'plan hypothesis');
  }

  // ─── parseAgenda: invalid inputs ────────────────────────────────────────

  console.log('\n=== parseAgenda: null input returns null ===');
  {
    assertEq(parseAgenda(null), null, 'null returns null');
    assertEq(parseAgenda(undefined), null, 'undefined returns null');
    assertEq(parseAgenda('string'), null, 'string returns null');
    assertEq(parseAgenda(42), null, 'number returns null');
    assertEq(parseAgenda([]), null, 'array returns null');
  }

  console.log('\n=== parseAgenda: missing required fields ===');
  {
    assertEq(parseAgenda({}), null, 'empty object');
    assertEq(parseAgenda({ phases: [] }), null, 'empty phases array');
    assertEq(parseAgenda({ phases: [{ name: 'a', experimentsPerPhase: 1 }] }), null, 'missing totalExperiments');
    assertEq(parseAgenda({ phases: [{ name: 'a', experimentsPerPhase: 1 }], totalExperiments: 5 }), null, 'missing researchQuestion');
    assertEq(parseAgenda({ phases: [{ name: 'a', experimentsPerPhase: 1 }], totalExperiments: 5, researchQuestion: '' }), null, 'empty researchQuestion');
  }

  console.log('\n=== parseAgenda: invalid phase entries ===');
  {
    const base = { researchQuestion: 'q', totalExperiments: 5 };
    assertEq(parseAgenda({ ...base, phases: [{ experimentsPerPhase: 1 }] }), null, 'phase missing name');
    assertEq(parseAgenda({ ...base, phases: [{ name: '', experimentsPerPhase: 1 }] }), null, 'phase empty name');
    assertEq(parseAgenda({ ...base, phases: [{ name: 'a' }] }), null, 'phase missing experimentsPerPhase');
    assertEq(parseAgenda({ ...base, phases: [{ name: 'a', experimentsPerPhase: 0 }] }), null, 'phase experimentsPerPhase = 0');
    assertEq(parseAgenda({ ...base, phases: [{ name: 'a', experimentsPerPhase: -1 }] }), null, 'phase experimentsPerPhase negative');
  }

  console.log('\n=== parseAgenda: maxExperiments exceeded ===');
  {
    const raw = {
      researchQuestion: 'test',
      totalExperiments: 20,
      phases: [
        { name: 'a', dimension: 'x', experimentsPerPhase: 8, goal: 'g1' },
        { name: 'b', dimension: 'y', experimentsPerPhase: 8, goal: 'g2' },
      ],
    };
    // Sum = 16, max = 10 → should return null
    assertEq(parseAgenda(raw, 10), null, 'sum exceeds maxExperiments');
    // Sum = 16, max = 20 → should pass
    assert(parseAgenda(raw, 20) !== null, 'sum within maxExperiments');
    // No maxExperiments → should pass
    assert(parseAgenda(raw) !== null, 'no maxExperiments constraint');
  }

  console.log('\n=== parseAgenda: missing optional phase fields get defaults ===');
  {
    const raw = {
      researchQuestion: 'test',
      totalExperiments: 5,
      phases: [{ name: 'phase1', experimentsPerPhase: 5 }],
    };
    const result = parseAgenda(raw);
    assert(result !== null, 'parses without dimension/goal');
    assertEq(result!.phases[0].dimension, '', 'missing dimension defaults to empty string');
    assertEq(result!.phases[0].goal, '', 'missing goal defaults to empty string');
  }

  // ─── State I/O ──────────────────────────────────────────────────────────

  console.log('\n=== writeAgendaState / readAgendaState: round-trip ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      const config = makeValidConfig();
      const state = createInitialAgendaState(config);

      writeAgendaState(dir, state);
      const read = readAgendaState(dir);

      assert(read !== null, 'round-trip returns non-null');
      assertEq(read!.version, 1, 'version is 1');
      assertEq(read!.currentPhaseIndex, 0, 'starts at phase 0');
      assertEq(read!.completedPhases.length, 0, 'no completed phases');
      assert('exploration' in read!.experimentRanges, 'exploration range present');
      assert('refinement' in read!.experimentRanges, 'refinement range present');
      assertEq(read!.experimentRanges['exploration'], { start: 1, end: 5 }, 'exploration range correct');
      assertEq(read!.experimentRanges['refinement'], { start: 6, end: 10 }, 'refinement range correct');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readAgendaState: missing file returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      const result = readAgendaState(dir);
      assertEq(result, null, 'missing file returns null');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readAgendaState: corrupt file returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      writeFileSync(join(dir, 'AGENDA-STATE.json'), 'not valid json{{{');
      const stderrLines: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => { stderrLines.push(args.join(' ')); };
      const result = readAgendaState(dir);
      console.error = origErr;
      assertEq(result, null, 'corrupt file returns null');
      assert(stderrLines.some(l => l.includes('[agenda]')), 'stderr warning emitted on corruption');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readAgendaState: empty file returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      writeFileSync(join(dir, 'AGENDA-STATE.json'), '');
      const result = readAgendaState(dir);
      assertEq(result, null, 'empty file returns null');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== readAgendaState: invalid shape returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      writeFileSync(join(dir, 'AGENDA-STATE.json'), JSON.stringify({ version: 1 }));
      const origErr = console.error;
      console.error = () => {}; // suppress warning
      const result = readAgendaState(dir);
      console.error = origErr;
      assertEq(result, null, 'missing fields returns null');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== writeAgendaState: atomic write (temp file removed) ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      const config = makeValidConfig();
      const state = createInitialAgendaState(config);
      writeAgendaState(dir, state);

      // Verify the temp file is gone and the main file exists
      assert(existsSync(join(dir, 'AGENDA-STATE.json')), 'main file exists');
      assert(!existsSync(join(dir, 'AGENDA-STATE.json.tmp')), 'temp file removed after rename');

      // Verify content is valid JSON
      const content = readFileSync(join(dir, 'AGENDA-STATE.json'), 'utf-8');
      const parsed = JSON.parse(content);
      assertEq(parsed.version, 1, 'written content is valid JSON with version');
    } finally {
      cleanup(dir);
    }
  }

  // ─── createInitialAgendaState ───────────────────────────────────────────

  console.log('\n=== createInitialAgendaState: correct ranges ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);

    assertEq(state.version, 1, 'version is 1');
    assertEq(state.currentPhaseIndex, 0, 'starts at phase 0');
    assertEq(state.completedPhases.length, 0, 'no completed phases');
    assertEq(Object.keys(state.phaseResults).length, 0, 'no phase results');
    assertEq(state.experimentRanges['exploration'].start, 1, 'exploration starts at 1');
    assertEq(state.experimentRanges['exploration'].end, 5, 'exploration ends at 5');
    assertEq(state.experimentRanges['refinement'].start, 6, 'refinement starts at 6');
    assertEq(state.experimentRanges['refinement'].end, 10, 'refinement ends at 10');
  }

  // ─── Phase Navigation ──────────────────────────────────────────────────

  console.log('\n=== getCurrentPhase: returns first phase initially ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const phase = getCurrentPhase(state, config);

    assert(phase !== null, 'current phase is not null');
    assertEq(phase!.name, 'exploration', 'first phase is exploration');
  }

  console.log('\n=== getCurrentPhase: returns null when all phases complete ===');
  {
    const config = makeValidConfig();
    const state: AgendaState = {
      ...createInitialAgendaState(config),
      currentPhaseIndex: config.phases.length,
    };
    const phase = getCurrentPhase(state, config);
    assertEq(phase, null, 'null when past last phase');
  }

  console.log('\n=== advancePhase: moves to next phase and records metrics ===');
  {
    const config = makeValidConfig();
    let state = createInitialAgendaState(config);

    const metrics = { accuracy: 0.85, loss: 0.15 };
    state = advancePhase(state, config, metrics);

    assertEq(state.currentPhaseIndex, 1, 'phase index incremented');
    assertEq(state.completedPhases, ['exploration'], 'exploration completed');
    assertEq(state.phaseResults['exploration'], metrics, 'metrics recorded for exploration');
  }

  console.log('\n=== advancePhase: advance through all phases ===');
  {
    const config = makeValidConfig();
    let state = createInitialAgendaState(config);

    // Advance phase 1
    state = advancePhase(state, config, { accuracy: 0.85 });
    assertEq(state.currentPhaseIndex, 1, 'after phase 1: index = 1');
    assertEq(getCurrentPhase(state, config)!.name, 'refinement', 'phase 2 is refinement');

    // Advance phase 2
    state = advancePhase(state, config, { accuracy: 0.92 });
    assertEq(state.currentPhaseIndex, 2, 'after phase 2: index = 2');
    assertEq(getCurrentPhase(state, config), null, 'all phases complete');
    assertEq(state.completedPhases, ['exploration', 'refinement'], 'both phases completed');
  }

  console.log('\n=== advancePhase: no-op when already complete ===');
  {
    const config = makeValidConfig();
    let state = createInitialAgendaState(config);
    state = advancePhase(state, config, { accuracy: 0.85 });
    state = advancePhase(state, config, { accuracy: 0.92 });

    // Try to advance past the end
    const before = { ...state };
    state = advancePhase(state, config, { accuracy: 0.95 });
    assertEq(state.currentPhaseIndex, before.currentPhaseIndex, 'index unchanged when complete');
  }

  console.log('\n=== shouldAdvancePhase: boundary detection ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);

    assert(!shouldAdvancePhase(state, 0, config), 'false at 0 experiments');
    assert(!shouldAdvancePhase(state, 3, config), 'false at 3 experiments');
    assert(!shouldAdvancePhase(state, 4, config), 'false at 4 experiments');
    assert(shouldAdvancePhase(state, 5, config), 'true at 5 experiments (= experimentsPerPhase)');
    assert(shouldAdvancePhase(state, 6, config), 'true at 6 experiments (> experimentsPerPhase)');
  }

  console.log('\n=== shouldAdvancePhase: false when all phases complete ===');
  {
    const config = makeValidConfig();
    const state: AgendaState = {
      ...createInitialAgendaState(config),
      currentPhaseIndex: config.phases.length,
    };
    assert(!shouldAdvancePhase(state, 100, config), 'false when all complete');
  }

  // ─── T02 Helper Functions ──────────────────────────────────────────────

  console.log('\n=== getPhaseContext: formats current phase info ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const ctx = getPhaseContext(state, config);

    assert(ctx.includes('exploration'), 'context includes phase name');
    assert(ctx.includes('Find promising learning rate ranges'), 'context includes goal');
    assert(ctx.includes('learning_rate'), 'context includes dimension');
    assert(ctx.includes('Phase 1 of 2'), 'context includes phase progress');
  }

  console.log('\n=== getPhaseContext: includes experiment plans ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const ctx = getPhaseContext(state, config);

    assert(ctx.includes('Test 1e-3'), 'context includes plan description');
    assert(ctx.includes('Standard LR works'), 'context includes plan hypothesis');
  }

  console.log('\n=== getPhaseContext: includes previous phase results after advance ===');
  {
    const config = makeValidConfig();
    let state = createInitialAgendaState(config);
    state = advancePhase(state, config, { accuracy: 0.85, loss: 0.15 });

    const ctx = getPhaseContext(state, config);
    assert(ctx.includes('exploration'), 'context references previous phase');
    assert(ctx.includes('0.85'), 'context includes previous metrics');
  }

  console.log('\n=== getPhaseContext: empty string when all phases complete ===');
  {
    const config = makeValidConfig();
    const state: AgendaState = {
      ...createInitialAgendaState(config),
      currentPhaseIndex: config.phases.length,
    };
    assertEq(getPhaseContext(state, config), '', 'empty when complete');
  }

  console.log('\n=== getPhaseBestMetrics: filters to current phase ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const experiments = makeExperiments(8);

    // Phase 1 is experiments 1-5, best kept is exp-004 (even=keep, highest in range)
    const best = getPhaseBestMetrics(experiments, state);
    assert(best !== null, 'best metrics found');
    assertEq(best!.accuracy, experiments[3].metrics.accuracy, 'best is exp-004 (last kept in phase 1)');
  }

  console.log('\n=== getPhaseBestMetrics: null when no kept experiments ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    // All odd experiments are discarded
    const experiments = makeExperiments(5).map(e => ({
      ...e,
      decision: { decision: 'discard' as const, reason: 'test', comparison: {} },
    }));
    const best = getPhaseBestMetrics(experiments, state);
    assertEq(best, null, 'null when no kept experiments');
  }

  console.log('\n=== getPhaseFilteredHistory: returns only current phase experiments ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const experiments = makeExperiments(10);

    const filtered = getPhaseFilteredHistory(experiments, state);
    assertEq(filtered.length, 5, 'phase 1 has 5 experiments');
    assertEq(filtered[0].id, 'exp-001', 'starts at exp-001');
    assertEq(filtered[4].id, 'exp-005', 'ends at exp-005');
  }

  console.log('\n=== getPhaseFilteredHistory: phase 2 experiments ===');
  {
    const config = makeValidConfig();
    let state = createInitialAgendaState(config);
    state = advancePhase(state, config, { accuracy: 0.85 });
    const experiments = makeExperiments(10);

    const filtered = getPhaseFilteredHistory(experiments, state);
    assertEq(filtered.length, 5, 'phase 2 has 5 experiments');
    assertEq(filtered[0].id, 'exp-006', 'starts at exp-006');
    assertEq(filtered[4].id, 'exp-010', 'ends at exp-010');
  }

  console.log('\n=== getPhaseFilteredHistory: empty when no experiments in range ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    const filtered = getPhaseFilteredHistory([], state);
    assertEq(filtered.length, 0, 'empty array for no experiments');
  }

  // ─── Backward Compatibility ────────────────────────────────────────────

  console.log('\n=== CampaignConfig: without agenda parses identically ===');
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
    assertEq(parsed.agenda, undefined, 'absent agenda parses as undefined');
    assertEq(parsed.name, 'legacy-campaign', 'other fields unaffected');
  }

  console.log('\n=== CampaignConfig: with agenda round-trips ===');
  {
    const agendaConfig = makeValidConfig();
    const config: CampaignConfig = {
      name: 'agenda-campaign',
      targetFiles: ['src/model.py'],
      evalConfig: { command: 'echo ok', timeout: 30, metrics: [], runs: 1 },
      maxExperiments: 10,
      budgetPerExperiment: 0.5,
      agenda: agendaConfig,
    };
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as CampaignConfig;
    assert(parsed.agenda !== undefined, 'agenda present after round-trip');
    assertEq(parsed.agenda!.phases.length, 2, 'agenda phases preserved');
    assertEq(parsed.agenda!.researchQuestion, agendaConfig.researchQuestion, 'research question preserved');
  }

  console.log('\n=== AgendaState: version field is always 1 ===');
  {
    const config = makeValidConfig();
    const state = createInitialAgendaState(config);
    assertEq(state.version, 1, 'initial state version is 1');

    const advanced = advancePhase(state, config, {});
    assertEq(advanced.version, 1, 'advanced state preserves version');
  }

  // ─── State Persistence: Full Workflow ──────────────────────────────────

  console.log('\n=== Full workflow: create → persist → advance → persist → read ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-agenda-test-'));
    try {
      const config = makeValidConfig();

      // Create and persist initial state
      let state = createInitialAgendaState(config);
      writeAgendaState(dir, state);

      // Read back
      let read = readAgendaState(dir);
      assertEq(read!.currentPhaseIndex, 0, 'workflow: starts at phase 0');

      // Advance and persist
      state = advancePhase(state, config, { accuracy: 0.9 });
      writeAgendaState(dir, state);

      // Read back after advance
      read = readAgendaState(dir);
      assertEq(read!.currentPhaseIndex, 1, 'workflow: advanced to phase 1');
      assertEq(read!.completedPhases, ['exploration'], 'workflow: exploration completed');
      assertEq(read!.phaseResults['exploration'], { accuracy: 0.9 }, 'workflow: metrics recorded');
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
