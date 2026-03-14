/**
 * Integration tests for phase-aware campaign execution (T02).
 * Covers: checkAndAdvancePhase, getPhasePromptOverrides, stampPhaseIndex,
 * phase boundary detection, phase context generation, phase-filtered history,
 * phase-level best metrics, prompt template phaseContext, non-agenda backward compat.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  checkAndAdvancePhase,
  getPhasePromptOverrides,
  stampPhaseIndex,
  readAgendaState,
  writeAgendaState,
  createInitialAgendaState,
  shouldAdvancePhase,
  getPhaseContext,
  getPhaseBestMetrics,
  getPhaseFilteredHistory,
  getCurrentPhase,
} from '../agenda.ts';

import { loadPrompt } from '../prompt-loader.ts';

import type {
  AgendaConfig,
  AgendaState,
  ExperimentResult,
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

function assertEq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${e}, got ${a}`);
  }
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'agenda-exec-test-'));
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

function makeAgendaConfig(overrides?: Partial<AgendaConfig>): AgendaConfig {
  return {
    researchQuestion: 'How to optimize model performance?',
    totalExperiments: 10,
    phases: [
      {
        name: 'exploration',
        dimension: 'architecture',
        goal: 'Find best architecture',
        experimentsPerPhase: 5,
        experimentPlans: [],
      },
      {
        name: 'refinement',
        dimension: 'hyperparameters',
        goal: 'Tune hyperparameters',
        experimentsPerPhase: 5,
        experimentPlans: [],
      },
    ],
    ...overrides,
  };
}

function makeExperiment(id: string, decision: 'keep' | 'discard', metrics: Record<string, number>): ExperimentResult {
  return {
    id,
    description: `experiment ${id}`,
    metrics,
    decision: { decision, reason: 'test', comparison: {} },
    duration: 100,
    cost: 0.01,
    diff: 'test',
    timestamp: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  console.log('agenda-execution tests\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. shouldAdvancePhase — boundary detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── shouldAdvancePhase ──');
  {
    const config = makeAgendaConfig();
    const state = createInitialAgendaState(config);

    // Not enough experiments yet
    assert(!shouldAdvancePhase(state, 0, config), 'shouldAdvance: 0 of 5 = false');
    assert(!shouldAdvancePhase(state, 3, config), 'shouldAdvance: 3 of 5 = false');
    assert(!shouldAdvancePhase(state, 4, config), 'shouldAdvance: 4 of 5 = false');

    // Exactly at boundary
    assert(shouldAdvancePhase(state, 5, config), 'shouldAdvance: 5 of 5 = true');

    // Over boundary
    assert(shouldAdvancePhase(state, 6, config), 'shouldAdvance: 6 of 5 = true');

    // All phases complete
    const completeState: AgendaState = {
      ...state,
      currentPhaseIndex: 2,
      completedPhases: ['exploration', 'refinement'],
    };
    assert(!shouldAdvancePhase(completeState, 10, config), 'shouldAdvance: all phases complete = false');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. checkAndAdvancePhase — facade function
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── checkAndAdvancePhase ──');
  {
    const dir = makeDir();
    try {
      const config = makeAgendaConfig();
      const experiments: ExperimentResult[] = [];

      // First call with no state file — creates it + no advance
      const msg1 = checkAndAdvancePhase(dir, config, 1, experiments);
      assertEq(msg1, null, 'checkAdvance: first call, no advance');

      // Verify state was created
      const state1 = readAgendaState(dir);
      assert(state1 !== null, 'checkAdvance: state file created');
      assertEq(state1!.currentPhaseIndex, 0, 'checkAdvance: starts at phase 0');

      // Add experiments for phase 1 (experiments 1-5)
      for (let i = 1; i <= 5; i++) {
        experiments.push(makeExperiment(`exp-${String(i).padStart(3, '0')}`, i === 3 ? 'keep' : 'discard', { accuracy: 0.5 + i * 0.05 }));
      }

      // Call at boundary — should advance
      const msg2 = checkAndAdvancePhase(dir, config, 6, experiments);
      assert(msg2 !== null, 'checkAdvance: advance message returned');
      assert(msg2!.includes('→'), 'checkAdvance: message contains arrow');

      // Verify state was advanced
      const state2 = readAgendaState(dir);
      assertEq(state2!.currentPhaseIndex, 1, 'checkAdvance: advanced to phase 1');
      assert(state2!.completedPhases.includes('exploration'), 'checkAdvance: exploration completed');
      assert(state2!.phaseResults['exploration'] !== undefined, 'checkAdvance: phase results recorded');

      // Call again — should not advance again (still in phase 1)
      const msg3 = checkAndAdvancePhase(dir, config, 6, experiments);
      assertEq(msg3, null, 'checkAdvance: no double-advance');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. getPhaseContext — markdown generation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── getPhaseContext ──');
  {
    const config = makeAgendaConfig();
    const state = createInitialAgendaState(config);

    // Phase 0 context
    const ctx0 = getPhaseContext(state, config);
    assert(ctx0.includes('exploration'), 'phaseContext: contains phase name');
    assert(ctx0.includes('Find best architecture'), 'phaseContext: contains goal');
    assert(ctx0.includes('architecture'), 'phaseContext: contains dimension');
    assert(ctx0.includes('Phase 1 of 2'), 'phaseContext: shows phase position');
    assert(!ctx0.includes('Previous Phase'), 'phaseContext: no previous phase results in phase 0');

    // Phase 1 context (after advance)
    const state1 = {
      ...state,
      currentPhaseIndex: 1,
      completedPhases: ['exploration'],
      phaseResults: { exploration: { accuracy: 0.85 } },
    };
    const ctx1 = getPhaseContext(state1, config);
    assert(ctx1.includes('refinement'), 'phaseContext phase1: contains phase name');
    assert(ctx1.includes('Tune hyperparameters'), 'phaseContext phase1: contains goal');
    assert(ctx1.includes('Previous Phase Results'), 'phaseContext phase1: shows previous results');
    assert(ctx1.includes('accuracy: 0.85'), 'phaseContext phase1: shows previous metrics');

    // All phases complete — empty string
    const completedState: AgendaState = {
      ...state,
      currentPhaseIndex: 2,
      completedPhases: ['exploration', 'refinement'],
    };
    const ctxDone = getPhaseContext(completedState, config);
    assertEq(ctxDone, '', 'phaseContext: empty when all phases complete');

    // No-agenda case: getPhaseContext not called (phaseContext = '')
    // This is tested indirectly via getPhasePromptOverrides
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. getPhaseBestMetrics — phase-scoped metrics
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── getPhaseBestMetrics ──');
  {
    const config = makeAgendaConfig();
    const state = createInitialAgendaState(config);

    // No experiments — null
    assertEq(getPhaseBestMetrics([], state), null, 'phaseBest: no experiments = null');

    // Experiments from phase 0 range (1-5), with one keep
    const experiments: ExperimentResult[] = [
      makeExperiment('exp-001', 'discard', { accuracy: 0.5 }),
      makeExperiment('exp-002', 'keep', { accuracy: 0.7 }),
      makeExperiment('exp-003', 'discard', { accuracy: 0.6 }),
      makeExperiment('exp-004', 'keep', { accuracy: 0.8 }),
      makeExperiment('exp-005', 'discard', { accuracy: 0.65 }),
    ];

    const best = getPhaseBestMetrics(experiments, state);
    assert(best !== null, 'phaseBest: found kept experiment');
    assertEq(best!.accuracy, 0.8, 'phaseBest: returns latest kept metrics (exp-004)');

    // Experiments from phase 1 range (6-10) — should not be included in phase 0 results
    const phase1Exps = [
      ...experiments,
      makeExperiment('exp-006', 'keep', { accuracy: 0.95 }),
    ];
    const best2 = getPhaseBestMetrics(phase1Exps, state);
    assertEq(best2!.accuracy, 0.8, 'phaseBest: ignores experiments outside current phase range');

    // All discarded in phase — null
    const allDiscarded: ExperimentResult[] = [
      makeExperiment('exp-001', 'discard', { accuracy: 0.5 }),
      makeExperiment('exp-002', 'discard', { accuracy: 0.6 }),
    ];
    assertEq(getPhaseBestMetrics(allDiscarded, state), null, 'phaseBest: all discarded = null');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. getPhaseFilteredHistory — phase-scoped experiments
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── getPhaseFilteredHistory ──');
  {
    const config = makeAgendaConfig();
    const state = createInitialAgendaState(config);

    // Phase 0 (experiments 1-5)
    const allExps: ExperimentResult[] = [];
    for (let i = 1; i <= 8; i++) {
      allExps.push(makeExperiment(`exp-${String(i).padStart(3, '0')}`, 'discard', { accuracy: i * 0.1 }));
    }

    const phase0 = getPhaseFilteredHistory(allExps, state);
    assertEq(phase0.length, 5, 'phaseHistory: phase 0 has 5 experiments');
    assertEq(phase0[0].id, 'exp-001', 'phaseHistory: starts at exp-001');
    assertEq(phase0[4].id, 'exp-005', 'phaseHistory: ends at exp-005');

    // Phase 1 (experiments 6-10)
    const state1: AgendaState = {
      ...state,
      currentPhaseIndex: 1,
      completedPhases: ['exploration'],
    };
    const phase1 = getPhaseFilteredHistory(allExps, state1);
    assertEq(phase1.length, 3, 'phaseHistory: phase 1 has 3 experiments (6-8 of 6-10)');
    assertEq(phase1[0].id, 'exp-006', 'phaseHistory: starts at exp-006');

    // Empty experiments
    assertEq(getPhaseFilteredHistory([], state).length, 0, 'phaseHistory: empty input = empty output');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. getPhasePromptOverrides — facade function
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── getPhasePromptOverrides ──');
  {
    const dir = makeDir();
    try {
      const config = makeAgendaConfig();

      // No state file — returns defaults
      const r1 = getPhasePromptOverrides(dir, config, [], null);
      assertEq(r1.phaseContext, '', 'promptOverrides: no state = empty context');
      assertEq(r1.experiments.length, 0, 'promptOverrides: no state = same experiments');
      assertEq(r1.bestMetrics, null, 'promptOverrides: no state = same metrics');

      // With state file
      const state = createInitialAgendaState(config);
      writeAgendaState(dir, state);
      const experiments = [
        makeExperiment('exp-001', 'keep', { accuracy: 0.7 }),
        makeExperiment('exp-002', 'discard', { accuracy: 0.6 }),
        makeExperiment('exp-006', 'keep', { accuracy: 0.9 }), // outside phase 0
      ];
      const globalBest = { accuracy: 0.9 };

      const r2 = getPhasePromptOverrides(dir, config, experiments, globalBest);
      assert(r2.phaseContext.includes('exploration'), 'promptOverrides: phase context populated');
      assertEq(r2.experiments.length, 2, 'promptOverrides: filtered to phase 0 experiments');
      assertEq(r2.bestMetrics!.accuracy, 0.7, 'promptOverrides: phase-level best metrics');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. stampPhaseIndex — experiment result annotation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── stampPhaseIndex ──');
  {
    const dir = makeDir();
    try {
      const config = makeAgendaConfig();
      const state = createInitialAgendaState(config);
      writeAgendaState(dir, state);

      // Write a JSONL with one experiment
      const exp = makeExperiment('exp-001', 'keep', { accuracy: 0.7 });
      const logPath = join(dir, 'EXPERIMENT-LOG.jsonl');
      writeFileSync(logPath, JSON.stringify(exp) + '\n');

      stampPhaseIndex(dir, exp);
      assertEq(exp.phaseIndex, 0, 'stampPhaseIndex: sets phaseIndex on result');

      // Verify JSONL was patched
      const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n');
      const patched = JSON.parse(lines[0]);
      assertEq(patched.phaseIndex, 0, 'stampPhaseIndex: JSONL patched with phaseIndex');

      // No state file — no-op
      const dir2 = makeDir();
      const exp2 = makeExperiment('exp-002', 'keep', { accuracy: 0.8 });
      stampPhaseIndex(dir2, exp2);
      assertEq(exp2.phaseIndex, undefined, 'stampPhaseIndex: no state = no phaseIndex');
      cleanup(dir2);
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Prompt template — phaseContext variable
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── prompt template ──');
  {
    const baseVars = {
      experimentNumber: '1',
      milestoneId: 'M001',
      sliceId: 'S01',
      researchQuestion: 'How to optimize?',
      campaignName: 'test-campaign',
      targetFileList: '`model.py`',
      maxExperiments: '10',
      budgetPerExperiment: '0.50',
      evalCommand: 'python eval.py',
      evalTimeout: '60',
      evalRuns: '1',
      metricDefinitions: '- **accuracy**: direction=max, weight=1',
      targetFileSources: '### `model.py`\n\n```\nprint("hello")\n```',
      bestMetrics: '- **accuracy:** 0.8500',
      experimentHistory: '_No prior experiments — this is the first one._',
    };

    // Non-agenda: empty phaseContext produces clean prompt
    const promptNoAgenda = loadPrompt('run-experiment', { ...baseVars, phaseContext: '' });
    assert(!promptNoAgenda.includes('Current Phase'), 'template: no phase context when empty');
    assert(promptNoAgenda.includes('Campaign Overview'), 'template: campaign overview present');
    assert(promptNoAgenda.includes('How to optimize?'), 'template: research question present');

    // Agenda: phaseContext populated
    const phaseCtx = '## Current Phase: exploration\n\n**Goal:** Find best architecture\n**Dimension:** architecture\n**Experiments in phase:** 5\n**Phase 1 of 2**';
    const promptWithAgenda = loadPrompt('run-experiment', { ...baseVars, phaseContext: phaseCtx });
    assert(promptWithAgenda.includes('Current Phase: exploration'), 'template: phase context visible');
    assert(promptWithAgenda.includes('Find best architecture'), 'template: phase goal visible');
    assert(promptWithAgenda.includes('Phase 1 of 2'), 'template: phase position visible');
    assert(promptWithAgenda.includes('Campaign Overview'), 'template: campaign overview still present');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Non-agenda backward compatibility
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── non-agenda backward compat ──');
  {
    const dir = makeDir();
    try {
      // No agenda state file exists, no agenda config — pure default behavior
      const r = getPhasePromptOverrides(dir, makeAgendaConfig(), [], null);
      // Even with an agenda config, if no state file exists, returns defaults
      assertEq(r.phaseContext, '', 'compat: no state = empty phase context');

      // checkAndAdvancePhase with no experiments — creates state, returns null
      const msg = checkAndAdvancePhase(dir, makeAgendaConfig(), 1, []);
      assertEq(msg, null, 'compat: first experiment = no advance');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Phase context with experiment plans
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── phase context with experiment plans ──');
  {
    const config = makeAgendaConfig({
      phases: [
        {
          name: 'architecture-search',
          dimension: 'architecture',
          goal: 'Find optimal model architecture',
          experimentsPerPhase: 3,
          experimentPlans: [
            { description: 'Try deeper network', hypothesis: 'More layers improve accuracy', targetFocus: 'model.py' },
            { description: 'Try wider network', hypothesis: 'More neurons improve accuracy', targetFocus: 'model.py' },
          ],
        },
      ],
    });
    const state = createInitialAgendaState(config);
    const ctx = getPhaseContext(state, config);
    assert(ctx.includes('Experiment Plans'), 'withPlans: contains experiment plans section');
    assert(ctx.includes('Try deeper network'), 'withPlans: contains plan description');
    assert(ctx.includes('More layers improve accuracy'), 'withPlans: contains hypothesis');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 11. Failure paths — corrupt state, complete agenda
  // ═══════════════════════════════════════════════════════════════════════
  console.log('── failure paths ──');
  {
    const dir = makeDir();
    try {
      // Corrupt AGENDA-STATE.json — getPhasePromptOverrides degrades gracefully
      writeFileSync(join(dir, 'AGENDA-STATE.json'), 'not json');
      const r = getPhasePromptOverrides(dir, makeAgendaConfig(), [], { accuracy: 0.5 });
      assertEq(r.phaseContext, '', 'corrupt state: empty phase context');
      assertEq(r.bestMetrics!.accuracy, 0.5, 'corrupt state: falls back to global metrics');

      // All phases complete — getPhaseContext returns empty
      const config = makeAgendaConfig();
      const doneState: AgendaState = {
        version: 1,
        currentPhaseIndex: 2,
        phaseResults: { exploration: { accuracy: 0.85 }, refinement: { accuracy: 0.92 } },
        experimentRanges: { exploration: { start: 1, end: 5 }, refinement: { start: 6, end: 10 } },
        completedPhases: ['exploration', 'refinement'],
      };
      writeAgendaState(dir, doneState);
      const r2 = getPhasePromptOverrides(dir, config, [], null);
      assertEq(r2.phaseContext, '', 'complete agenda: empty phase context');

      // checkAndAdvancePhase with complete agenda — null
      const msg = checkAndAdvancePhase(dir, config, 11, []);
      assertEq(msg, null, 'complete agenda: checkAdvance returns null');
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
