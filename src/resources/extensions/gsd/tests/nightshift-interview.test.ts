// NightShift Interview — Contract tests proving scaffold parses correctly
// Verifies generateNightShiftScaffold() output roundtrips through
// parseRoadmapSlices, parsePlan, and parseCampaignConfig.

import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateNightShiftScaffold } from '../nightshift-interview.ts';
import type { NightShiftInterviewResult } from '../nightshift-interview.ts';
import { parseRoadmapSlices } from '../roadmap-slices.ts';
import { parsePlan } from '../files.ts';
import { parseCampaignConfig } from '../state.ts';

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

// ─── Fixture Helpers ───────────────────────────────────────────────────────

function createFixtureBase(): string {
  const base = mkdtempSync(join(tmpdir(), 'nightshift-test-'));
  mkdirSync(join(base, '.gsd', 'milestones'), { recursive: true });
  return base;
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

function padId(prefix: string, n: number): string {
  return `${prefix}${n < 10 ? '0' : ''}${n}`;
}

function readRoadmap(base: string): string {
  return readFileSync(join(base, '.gsd', 'milestones', 'M001', 'M001-ROADMAP.md'), 'utf-8');
}

function readPlan(base: string, sliceId: string): string {
  return readFileSync(
    join(base, '.gsd', 'milestones', 'M001', 'slices', sliceId, `${sliceId}-PLAN.md`),
    'utf-8',
  );
}

function sliceDir(base: string, sliceId: string): string {
  return join(base, '.gsd', 'milestones', 'M001', 'slices', sliceId);
}

// ─── Default Config ────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<NightShiftInterviewResult>): NightShiftInterviewResult {
  return {
    targetFiles: ['src/model.py'],
    evalCommand: 'python eval.py',
    metrics: [{ name: 'accuracy', direction: 'max', weight: 1.0 }],
    hypothesisCount: 3,
    experimentsPerHypothesis: 5,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── Test 1: 3 hypotheses × 5 experiments — standard roundtrip ────────
  console.log('\n=== 3 hypotheses × 5 experiments — standard roundtrip ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig();
      generateNightShiftScaffold(base, config);

      // Roadmap parses with 3 slices
      const roadmapContent = readRoadmap(base);
      const slices = parseRoadmapSlices(roadmapContent);
      assertEq(slices.length, 3, 'roadmap has 3 slices');
      assertEq(slices[0].id, 'S01', 'first slice is S01');
      assertEq(slices[1].id, 'S02', 'second slice is S02');
      assertEq(slices[2].id, 'S03', 'third slice is S03');
      assert(slices.every(s => !s.done), 'all slices not done');

      // Each plan parses with 5 tasks
      for (let i = 1; i <= 3; i++) {
        const sid = padId('S', i);
        const planContent = readPlan(base, sid);
        const plan = parsePlan(planContent);
        assertEq(plan.tasks.length, 5, `${sid} plan has 5 tasks`);
        assert(plan.tasks.every(t => !t.done), `${sid} all tasks not done`);
        for (let j = 1; j <= 5; j++) {
          assertEq(plan.tasks[j - 1].id, padId('T', j), `${sid} task ${j} id is ${padId('T', j)}`);
        }
      }

      // CAMPAIGN.json validates for each slice
      for (let i = 1; i <= 3; i++) {
        const sid = padId('S', i);
        const campaign = parseCampaignConfig(sliceDir(base, sid));
        assert(campaign !== null, `${sid} CAMPAIGN.json parses`);
        assertEq(campaign!.maxExperiments, 5, `${sid} maxExperiments is 5`);
        assertEq(campaign!.targetFiles, ['src/model.py'], `${sid} targetFiles correct`);
        assertEq(campaign!.evalConfig.command, 'python eval.py', `${sid} evalConfig.command correct`);
      }
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 2: 1 hypothesis × 1 experiment — edge case ─────────────────
  console.log('\n=== 1 hypothesis × 1 experiment — edge case ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({ hypothesisCount: 1, experimentsPerHypothesis: 1 });
      generateNightShiftScaffold(base, config);

      const slices = parseRoadmapSlices(readRoadmap(base));
      assertEq(slices.length, 1, 'roadmap has 1 slice');
      assertEq(slices[0].id, 'S01', 'single slice is S01');
      assert(!slices[0].done, 'slice not done');

      const plan = parsePlan(readPlan(base, 'S01'));
      assertEq(plan.tasks.length, 1, 'plan has 1 task');
      assertEq(plan.tasks[0].id, 'T01', 'single task is T01');
      assert(!plan.tasks[0].done, 'task not done');

      const campaign = parseCampaignConfig(sliceDir(base, 'S01'));
      assert(campaign !== null, 'CAMPAIGN.json parses');
      assertEq(campaign!.maxExperiments, 1, 'maxExperiments is 1');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 3: 10+ hypotheses — ID padding (S10, S11, no S010) ─────────
  console.log('\n=== 10+ hypotheses — ID padding ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({ hypothesisCount: 12, experimentsPerHypothesis: 2 });
      generateNightShiftScaffold(base, config);

      const slices = parseRoadmapSlices(readRoadmap(base));
      assertEq(slices.length, 12, 'roadmap has 12 slices');

      // Single-digit padded: S01-S09
      assertEq(slices[0].id, 'S01', 'first slice S01');
      assertEq(slices[8].id, 'S09', 'ninth slice S09');

      // Double-digit: S10, S11, S12 (no zero padding)
      assertEq(slices[9].id, 'S10', 'tenth slice S10 not S010');
      assertEq(slices[10].id, 'S11', 'eleventh slice S11');
      assertEq(slices[11].id, 'S12', 'twelfth slice S12');

      // Plans and campaigns parse for S10+
      for (const sid of ['S10', 'S11', 'S12']) {
        const plan = parsePlan(readPlan(base, sid));
        assertEq(plan.tasks.length, 2, `${sid} plan has 2 tasks`);
        assert(plan.tasks.every(t => !t.done), `${sid} tasks not done`);

        const campaign = parseCampaignConfig(sliceDir(base, sid));
        assert(campaign !== null, `${sid} CAMPAIGN.json parses`);
      }
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 4: Priors present — PRIORS.md created in each slice dir ─────
  console.log('\n=== priors present — PRIORS.md created ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({
        hypothesisCount: 2,
        priors: 'The model responds well to learning rate tuning.',
      });
      generateNightShiftScaffold(base, config);

      for (const sid of ['S01', 'S02']) {
        const priorsPath = join(sliceDir(base, sid), 'PRIORS.md');
        assert(existsSync(priorsPath), `${sid} PRIORS.md exists`);
        const content = readFileSync(priorsPath, 'utf-8');
        assert(content.includes('learning rate tuning'), `${sid} PRIORS.md has user content`);
      }

      // Campaign JSON also carries priors field
      const campaign = parseCampaignConfig(sliceDir(base, 'S01'));
      assert(campaign !== null, 'CAMPAIGN.json parses with priors');
      assert(campaign!.priors !== undefined, 'campaign.priors present');
      assert(
        (campaign!.priors as string).includes('learning rate tuning'),
        'campaign.priors has user content',
      );
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 5: Priors absent — no PRIORS.md file created ────────────────
  console.log('\n=== priors absent — no PRIORS.md ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({ hypothesisCount: 1 });
      // config has no priors field (undefined)
      generateNightShiftScaffold(base, config);

      const priorsPath = join(sliceDir(base, 'S01'), 'PRIORS.md');
      assert(!existsSync(priorsPath), 'PRIORS.md does not exist');

      const campaign = parseCampaignConfig(sliceDir(base, 'S01'));
      assert(campaign !== null, 'CAMPAIGN.json parses without priors');
      assert(campaign!.priors === undefined, 'campaign.priors absent');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 6: Mixed metric directions — min and max preserved ──────────
  console.log('\n=== mixed metric directions ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({
        hypothesisCount: 1,
        experimentsPerHypothesis: 3,
        metrics: [
          { name: 'accuracy', direction: 'max', weight: 0.7 },
          { name: 'loss', direction: 'min', weight: 0.2 },
          { name: 'latency_ms', direction: 'min', weight: 0.1 },
        ],
      });
      generateNightShiftScaffold(base, config);

      const campaign = parseCampaignConfig(sliceDir(base, 'S01'));
      assert(campaign !== null, 'CAMPAIGN.json parses with mixed metrics');
      assertEq(campaign!.evalConfig.metrics.length, 3, '3 metrics present');

      const m0 = campaign!.evalConfig.metrics[0];
      assertEq(m0.name, 'accuracy', 'metric 0 name');
      assertEq(m0.direction, 'max', 'metric 0 direction max');

      const m1 = campaign!.evalConfig.metrics[1];
      assertEq(m1.name, 'loss', 'metric 1 name');
      assertEq(m1.direction, 'min', 'metric 1 direction min');

      const m2 = campaign!.evalConfig.metrics[2];
      assertEq(m2.name, 'latency_ms', 'metric 2 name');
      assertEq(m2.direction, 'min', 'metric 2 direction min');

      // Weights preserved
      assertEq(m0.weight, 0.7, 'metric 0 weight');
      assertEq(m1.weight, 0.2, 'metric 1 weight');
      assertEq(m2.weight, 0.1, 'metric 2 weight');
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 7: NightShift naming — no GSD/labrat/Labrat in output ───────
  console.log('\n=== NightShift naming — no GSD/labrat/Labrat ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({ hypothesisCount: 2, experimentsPerHypothesis: 3 });
      generateNightShiftScaffold(base, config);

      // Check roadmap
      const roadmap = readRoadmap(base);
      assert(!/\bGSD\b/.test(roadmap), 'roadmap has no "GSD"');
      assert(!/\blabrat\b/i.test(roadmap), 'roadmap has no "labrat"');

      // Check all plan files
      for (const sid of ['S01', 'S02']) {
        const plan = readPlan(base, sid);
        assert(!/\bGSD\b/.test(plan), `${sid} plan has no "GSD"`);
        assert(!/\blabrat\b/i.test(plan), `${sid} plan has no "labrat"`);
      }

      // Check CAMPAIGN.json
      for (const sid of ['S01', 'S02']) {
        const campaignRaw = readFileSync(join(sliceDir(base, sid), 'CAMPAIGN.json'), 'utf-8');
        assert(!/\bGSD\b/.test(campaignRaw), `${sid} CAMPAIGN.json has no "GSD"`);
        assert(!/\blabrat\b/i.test(campaignRaw), `${sid} CAMPAIGN.json has no "labrat"`);
      }
    } finally {
      cleanup(base);
    }
  }

  // ─── Test 8: 10+ experiments per hypothesis — T10 padding ─────────────
  console.log('\n=== 10+ experiments — T10 padding ===');
  {
    const base = createFixtureBase();
    try {
      const config = makeConfig({ hypothesisCount: 1, experimentsPerHypothesis: 12 });
      generateNightShiftScaffold(base, config);

      const plan = parsePlan(readPlan(base, 'S01'));
      assertEq(plan.tasks.length, 12, 'plan has 12 tasks');
      assertEq(plan.tasks[0].id, 'T01', 'first task T01');
      assertEq(plan.tasks[8].id, 'T09', 'ninth task T09');
      assertEq(plan.tasks[9].id, 'T10', 'tenth task T10 not T010');
      assertEq(plan.tasks[10].id, 'T11', 'eleventh task T11');
      assertEq(plan.tasks[11].id, 'T12', 'twelfth task T12');

      const campaign = parseCampaignConfig(sliceDir(base, 'S01'));
      assertEq(campaign!.maxExperiments, 12, 'maxExperiments is 12');
    } finally {
      cleanup(base);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(`\nnightshift-interview: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
