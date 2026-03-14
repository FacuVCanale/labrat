/**
 * Contract tests for GSD research types and state machine wiring.
 * Verifies:
 * - deriveState returns 'experimenting' when campaign config exists
 * - deriveState returns normal phase when no campaign config
 * - deriveState handles malformed campaign config gracefully
 * - classifyUnitPhase returns 'experiment' for 'run-experiment'
 * - Research types compile and serialize correctly
 * - Experiment progress is included in state
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveState } from '../state.js';
import { parseCampaignConfig, countExperiments } from '../state.js';
import { classifyUnitPhase } from '../metrics.js';
import type {
  ExperimentResult,
  MetricDefinition,
  EvaluationConfig,
  KeepDiscardDecision,
  CampaignConfig,
  ExperimentContext,
} from '../types.js';

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

// ─── Fixture Helpers ────────────────────────────────────────────────────────

function createFixtureBase(): string {
  const base = mkdtempSync(join(tmpdir(), 'gsd-research-test-'));
  mkdirSync(join(base, '.gsd', 'milestones'), { recursive: true });
  return base;
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

function writeCampaignConfig(base: string, mid: string, sid: string, config: CampaignConfig): void {
  const dir = join(base, '.gsd', 'milestones', mid, 'slices', sid);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(config, null, 2));
}

function writeExperimentLog(base: string, mid: string, sid: string, entries: object[]): void {
  const dir = join(base, '.gsd', 'milestones', mid, 'slices', sid);
  mkdirSync(dir, { recursive: true });
  const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
  writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), content);
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

const SIMPLE_ROADMAP = `# M001: Test Milestone

## Vision
Test vision

## Success Criteria
- test

## Slices

- [ ] **S01: First Slice** \`risk:low\` \`depends:[]\`
  - After this: things work

## Boundary Map
(none)
`;

const SIMPLE_PLAN = `# S01: First Slice

**Goal:** Test goal
**Demo:** Test demo

## Must-Haves
- test

## Tasks

- [ ] **T01: First task** \`est:30m\`
  - Do: things

## Files Likely Touched
- test.ts
`;

const SAMPLE_CAMPAIGN: CampaignConfig = {
  name: "optimize-inference-speed",
  targetFiles: ["src/model.ts", "src/pipeline.ts"],
  evalConfig: {
    command: "npm run benchmark",
    timeout: 120,
    metrics: [
      { name: "latency_p99", direction: "min", weight: 0.7 },
      { name: "throughput", direction: "max", weight: 0.3 },
    ],
    runs: 3,
  },
  maxExperiments: 10,
  budgetPerExperiment: 0.50,
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── Test 1: deriveState returns 'experimenting' when campaign config exists ──
  console.log('\n=== campaign config present → experimenting phase ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', SIMPLE_ROADMAP);
      writePlan(base, 'M001', 'S01', SIMPLE_PLAN);
      writeCampaignConfig(base, 'M001', 'S01', SAMPLE_CAMPAIGN);

      const state = await deriveState(base);
      assertEq(state.phase, 'experimenting', 'phase should be experimenting');
      assert(state.activeSlice?.id === 'S01', 'active slice should be S01');
      assert(state.activeMilestone?.id === 'M001', 'active milestone should be M001');
      assert(state.nextAction.includes('experiment'), 'nextAction should mention experiment');
      assert(state.nextAction.includes('optimize-inference-speed'), 'nextAction should include campaign name');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 2: deriveState returns normal phase when no campaign config ────
  console.log('\n=== no campaign config → normal executing phase ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', SIMPLE_ROADMAP);
      writePlan(base, 'M001', 'S01', SIMPLE_PLAN);

      const state = await deriveState(base);
      assertEq(state.phase, 'executing', 'phase should be executing without campaign');
      assert(state.activeTask?.id === 'T01', 'active task should be T01');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 3: deriveState with malformed campaign config → normal phase ──
  console.log('\n=== malformed campaign config → normal phase (graceful fallback) ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', SIMPLE_ROADMAP);
      writePlan(base, 'M001', 'S01', SIMPLE_PLAN);

      // Write invalid JSON
      const sliceDir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      mkdirSync(join(sliceDir, 'tasks'), { recursive: true });
      writeFileSync(join(sliceDir, 'CAMPAIGN.json'), '{ invalid json }}}');

      const state = await deriveState(base);
      assertEq(state.phase, 'executing', 'phase should be executing with malformed campaign');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 4: deriveState with incomplete campaign config → normal phase ──
  console.log('\n=== incomplete campaign config (missing fields) → normal phase ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', SIMPLE_ROADMAP);
      writePlan(base, 'M001', 'S01', SIMPLE_PLAN);

      const sliceDir = join(base, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      mkdirSync(join(sliceDir, 'tasks'), { recursive: true });
      writeFileSync(join(sliceDir, 'CAMPAIGN.json'), JSON.stringify({ name: "partial" }));

      const state = await deriveState(base);
      assertEq(state.phase, 'executing', 'phase should be executing with incomplete campaign config');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 5: experiment progress is included in state ────────────────────
  console.log('\n=== experiment progress in state ===');
  {
    const base = createFixtureBase();
    try {
      writeRoadmap(base, 'M001', SIMPLE_ROADMAP);
      writePlan(base, 'M001', 'S01', SIMPLE_PLAN);
      writeCampaignConfig(base, 'M001', 'S01', SAMPLE_CAMPAIGN);

      // Write 3 experiment log entries
      writeExperimentLog(base, 'M001', 'S01', [
        { id: "exp-001", metrics: { latency: 100 } },
        { id: "exp-002", metrics: { latency: 95 } },
        { id: "exp-003", metrics: { latency: 90 } },
      ]);

      const state = await deriveState(base);
      assertEq(state.phase, 'experimenting', 'phase should be experimenting');
      assert(state.progress?.experiments !== undefined, 'experiments progress should be present');
      assertEq(state.progress?.experiments?.done, 3, 'should have 3 done experiments');
      assertEq(state.progress?.experiments?.total, 10, 'should have 10 total experiments');
      assert(state.nextAction.includes('4/10'), 'nextAction should say experiment 4/10');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 6: classifyUnitPhase returns 'experiment' for 'run-experiment' ──
  console.log('\n=== classifyUnitPhase("run-experiment") → "experiment" ===');
  {
    assertEq(classifyUnitPhase("run-experiment"), "experiment", 'run-experiment should classify as experiment');
    // Verify existing classifications still work
    assertEq(classifyUnitPhase("execute-task"), "execution", 'execute-task should still classify as execution');
    assertEq(classifyUnitPhase("research-milestone"), "research", 'research-milestone should still classify as research');
  }

  // ─── Test 7: CampaignConfig and ExperimentResult types compile and serialize ──
  console.log('\n=== type contracts: CampaignConfig and ExperimentResult serialize correctly ===');
  {
    const campaign: CampaignConfig = SAMPLE_CAMPAIGN;
    const serialized = JSON.stringify(campaign);
    const deserialized = JSON.parse(serialized) as CampaignConfig;
    assertEq(deserialized.name, campaign.name, 'campaign name should round-trip');
    assertEq(deserialized.maxExperiments, campaign.maxExperiments, 'maxExperiments should round-trip');
    assertEq(deserialized.evalConfig.metrics.length, 2, 'metrics should round-trip');

    const result: ExperimentResult = {
      id: "exp-001",
      description: "Increased batch size to 32",
      metrics: { latency_p99: 45.2, throughput: 1200 },
      decision: {
        decision: "keep",
        reason: "Improved both latency and throughput",
        comparison: {
          latency_p99: { before: 52.0, after: 45.2, improved: true },
          throughput: { before: 1000, after: 1200, improved: true },
        },
      },
      duration: 15000,
      cost: 0.35,
      diff: "src/pipeline.ts: batch_size 16→32",
    };
    const rSerialized = JSON.stringify(result);
    const rDeserialized = JSON.parse(rSerialized) as ExperimentResult;
    assertEq(rDeserialized.id, "exp-001", 'experiment id should round-trip');
    assertEq(rDeserialized.decision.decision, "keep", 'decision should round-trip');
  }

  // ─── Test 8: ExperimentContext type compiles and serializes ────────────────
  console.log('\n=== type contract: ExperimentContext serializes correctly ===');
  {
    const ctx: ExperimentContext = {
      experimentNumber: 5,
      targetFileSource: ["src/model.ts"],
      bestMetrics: { latency_p99: 42.0 },
      priorExperiments: [],
      researchQuestion: "Can we reduce p99 latency below 40ms?",
    };
    const serialized = JSON.stringify(ctx);
    const deserialized = JSON.parse(serialized) as ExperimentContext;
    assertEq(deserialized.experimentNumber, 5, 'experimentNumber should round-trip');
    assertEq(deserialized.researchQuestion, ctx.researchQuestion, 'researchQuestion should round-trip');
  }

  // ─── Test 9: parseCampaignConfig handles edge cases ────────────────────────
  console.log('\n=== parseCampaignConfig edge cases ===');
  {
    const base = createFixtureBase();
    try {
      // Non-existent directory
      assert(parseCampaignConfig('/non/existent/path') === null, 'non-existent path should return null');

      // Empty file
      const dir = join(base, 'empty-test');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'CAMPAIGN.json'), '');
      assert(parseCampaignConfig(dir) === null, 'empty file should return null');

      // Valid config
      writeFileSync(join(dir, 'CAMPAIGN.json'), JSON.stringify(SAMPLE_CAMPAIGN));
      const config = parseCampaignConfig(dir);
      assert(config !== null, 'valid config should parse');
      assertEq(config!.name, SAMPLE_CAMPAIGN.name, 'parsed name should match');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 10: countExperiments handles edge cases ──────────────────────────
  console.log('\n=== countExperiments edge cases ===');
  {
    const base = createFixtureBase();
    try {
      // Non-existent directory
      assertEq(countExperiments('/non/existent/path'), 0, 'non-existent path should return 0');

      // No log file
      const dir = join(base, 'count-test');
      mkdirSync(dir, { recursive: true });
      assertEq(countExperiments(dir), 0, 'no log file should return 0');

      // Empty log file
      writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), '');
      assertEq(countExperiments(dir), 0, 'empty log file should return 0');

      // Log with entries
      writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), '{"id":"exp-001"}\n{"id":"exp-002"}\n');
      assertEq(countExperiments(dir), 2, 'should count 2 entries');

      // Log with blank lines
      writeFileSync(join(dir, 'EXPERIMENT-LOG.jsonl'), '{"id":"exp-001"}\n\n{"id":"exp-002"}\n\n');
      assertEq(countExperiments(dir), 2, 'should ignore blank lines');
    } finally {
      cleanup(base);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════════════════════

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
