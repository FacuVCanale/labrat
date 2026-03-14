/**
 * Contract tests for GSD Morning Report.
 * Covers: generateMorningReport() with all report sections & edge cases,
 *         findActiveCampaignDir() with temp directory structures.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateMorningReport, findActiveCampaignDir } from '../morning-report.ts';
import type { MorningReportInput } from '../morning-report.ts';
import type { ExperimentResult, CampaignConfig } from '../types.ts';
import type { UnitMetrics, TokenCounts } from '../metrics.ts';

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

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeCampaign(overrides: Partial<CampaignConfig> = {}): CampaignConfig {
  return {
    name: 'Test Campaign',
    researchQuestion: 'Can we improve val_bpb?',
    targetFiles: ['train.py'],
    evalConfig: {
      command: 'python eval.py',
      timeout: 60,
      metrics: [
        { name: 'val_bpb', direction: 'min', weight: 1.0 },
      ],
      runs: 1,
    },
    maxExperiments: 20,
    budgetPerExperiment: 0.50,
    ...overrides,
  };
}

function makeExperiment(id: string, metrics: Record<string, number>, decision: 'keep' | 'discard', timestamp?: string): ExperimentResult {
  return {
    id,
    description: `Experiment ${id} modifications`,
    metrics,
    decision: {
      decision,
      reason: decision === 'keep' ? 'improvement' : 'regression',
      comparison: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, { before: v + 0.1, after: v, improved: decision === 'keep' }])
      ),
    },
    duration: 5000,
    cost: 0.05,
    diff: 'abc123',
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

function makeTokenCounts(total: number = 50000): TokenCounts {
  return { input: total * 0.6, output: total * 0.2, cacheRead: total * 0.1, cacheWrite: total * 0.1, total };
}

function makeLedgerUnit(id: string, cost: number = 0.05): UnitMetrics {
  return {
    type: 'run-experiment',
    id,
    model: 'claude-sonnet-4-20250514',
    startedAt: Date.now() - 10000,
    finishedAt: Date.now(),
    tokens: makeTokenCounts(),
    cost,
    toolCalls: 10,
    assistantMessages: 5,
    userMessages: 3,
  };
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — full report with all sections
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Full report with all sections ===');
  {
    const experiments: ExperimentResult[] = [
      makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep', '2026-03-14T10:00:00Z'),
      makeExperiment('exp-002', { val_bpb: 1.3 }, 'keep', '2026-03-14T10:30:00Z'),
      makeExperiment('exp-003', { val_bpb: 1.6 }, 'discard', '2026-03-14T11:00:00Z'),
      makeExperiment('exp-004', { val_bpb: 1.1 }, 'keep', '2026-03-14T11:30:00Z'),
    ];
    const input: MorningReportInput = {
      experiments,
      campaign: makeCampaign(),
      ledgerUnits: [makeLedgerUnit('M001/S01/T01', 0.10), makeLedgerUnit('M001/S01/T02', 0.15)],
      dashboardUrl: 'https://wandb.ai/test/project',
      useColor: false,
    };
    const report = generateMorningReport(input);

    // Campaign header
    assert(report.includes('Campaign: Test Campaign'), 'report contains campaign name');
    assert(report.includes('Can we improve val_bpb'), 'report contains research question');
    assert(report.includes('train.py'), 'report contains target files');

    // Experiment summary
    assert(report.includes('Experiment Summary'), 'report contains experiment summary section');
    assert(report.includes('Total: 4'), 'report shows total count 4');
    assert(report.includes('Kept: 3'), 'report shows kept count 3');
    assert(report.includes('Discarded: 1'), 'report shows discarded count 1');

    // Top experiments
    assert(report.includes('Top Experiments'), 'report contains top experiments section');
    assert(report.includes('exp-001'), 'report lists exp-001');
    assert(report.includes('exp-002'), 'report lists exp-002');
    assert(report.includes('exp-003'), 'report lists exp-003');
    assert(report.includes('exp-004'), 'report lists exp-004');

    // Trajectory
    assert(report.includes('Improvement Trajectory'), 'report contains trajectory section');
    assert(report.includes('exp-001'), 'trajectory references first kept');
    assert(report.includes('exp-004'), 'trajectory references best kept');

    // Cost breakdown
    assert(report.includes('Cost Breakdown'), 'report contains cost section');
    assert(report.includes('Total cost:'), 'report shows total cost');
    assert(report.includes('Avg per experiment:'), 'report shows avg cost');

    // Duration
    assert(report.includes('Duration'), 'report contains duration section');
    assert(report.includes('2026-03-14T10:00:00'), 'report shows earliest timestamp');
    assert(report.includes('2026-03-14T11:30:00'), 'report shows latest timestamp');
    assert(report.includes('minutes'), 'report shows duration in minutes');

    // Dashboard link
    assert(report.includes('https://wandb.ai/test/project'), 'report contains dashboard URL');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — zero experiments
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Zero experiments ===');
  {
    const input: MorningReportInput = {
      experiments: [],
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);

    assert(report.includes('Campaign: Test Campaign'), 'zero-exp report has campaign header');
    assert(report.includes('No experiments have been run yet'), 'zero-exp shows friendly message');
    assert(!report.includes('Experiment Summary'), 'zero-exp has no summary section');
    assert(!report.includes('Top Experiments'), 'zero-exp has no top experiments');
    assert(!report.includes('Trajectory'), 'zero-exp has no trajectory');
    assert(!report.includes('Cost Breakdown'), 'zero-exp has no cost section');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — single experiment (no trajectory)
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Single experiment (no trajectory) ===');
  {
    const input: MorningReportInput = {
      experiments: [makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep')],
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);

    assert(report.includes('Total: 1'), 'single-exp shows total 1');
    assert(report.includes('Kept: 1'), 'single-exp shows kept 1');
    assert(!report.includes('Improvement Trajectory'), 'single-exp has no trajectory (only one data point)');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — mixed kept/discarded with correct counts
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Mixed kept/discarded ===');
  {
    const experiments: ExperimentResult[] = [
      makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep'),
      makeExperiment('exp-002', { val_bpb: 1.7 }, 'discard'),
      makeExperiment('exp-003', { val_bpb: 1.8 }, 'discard'),
      makeExperiment('exp-004', { val_bpb: 1.2 }, 'keep'),
      makeExperiment('exp-005', { val_bpb: 2.0 }, 'discard'),
    ];
    const input: MorningReportInput = {
      experiments,
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);

    assert(report.includes('Total: 5'), 'mixed shows total 5');
    assert(report.includes('Kept: 2'), 'mixed shows kept 2');
    assert(report.includes('Discarded: 3'), 'mixed shows discarded 3');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — useColor false produces no ANSI escape codes
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== useColor: false — no ANSI codes ===');
  {
    const experiments: ExperimentResult[] = [
      makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep', '2026-03-14T10:00:00Z'),
      makeExperiment('exp-002', { val_bpb: 1.3 }, 'keep', '2026-03-14T10:30:00Z'),
      makeExperiment('exp-003', { val_bpb: 1.6 }, 'discard', '2026-03-14T11:00:00Z'),
    ];
    const input: MorningReportInput = {
      experiments,
      campaign: makeCampaign(),
      ledgerUnits: [makeLedgerUnit('M001/S01/T01')],
      dashboardUrl: 'https://wandb.ai/test/project',
      useColor: false,
    };
    const report = generateMorningReport(input);

    // ANSI escape codes start with \x1b[
    const hasAnsi = /\x1b\[/.test(report);
    assert(!hasAnsi, 'useColor=false produces zero ANSI escape codes');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — useColor true produces ANSI escape codes
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== useColor: true — has ANSI codes ===');
  {
    const experiments: ExperimentResult[] = [
      makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep'),
      makeExperiment('exp-002', { val_bpb: 1.6 }, 'discard'),
    ];
    const input: MorningReportInput = {
      experiments,
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: true,
    };
    const report = generateMorningReport(input);

    const hasAnsi = /\x1b\[/.test(report);
    assert(hasAnsi, 'useColor=true does produce ANSI escape codes');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — no cost data skips cost section
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== No cost data — skips cost section ===');
  {
    const input: MorningReportInput = {
      experiments: [makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep')],
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);
    assert(!report.includes('Cost Breakdown'), 'null ledgerUnits skips cost section');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — empty ledger units skips cost section
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Empty ledger units — skips cost section ===');
  {
    const input: MorningReportInput = {
      experiments: [makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep')],
      campaign: makeCampaign(),
      ledgerUnits: [],
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);
    assert(!report.includes('Cost Breakdown'), 'empty ledgerUnits skips cost section');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — no dashboard URL skips dashboard line
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== No dashboard URL — skips dashboard line ===');
  {
    const input: MorningReportInput = {
      experiments: [makeExperiment('exp-001', { val_bpb: 1.5 }, 'keep')],
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: null,
      useColor: false,
    };
    const report = generateMorningReport(input);
    assert(!report.includes('Dashboard:'), 'null dashboardUrl skips dashboard line');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // generateMorningReport — zero experiments with dashboard URL shows it
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== Zero experiments with dashboard URL ===');
  {
    const input: MorningReportInput = {
      experiments: [],
      campaign: makeCampaign(),
      ledgerUnits: null,
      dashboardUrl: 'https://wandb.ai/test',
      useColor: false,
    };
    const report = generateMorningReport(input);
    assert(report.includes('Dashboard: https://wandb.ai/test'), 'zero-exp still shows dashboard URL');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // findActiveCampaignDir — finds CAMPAIGN.json
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== findActiveCampaignDir — finds campaign ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-report-'));
    try {
      // Create .gsd/milestones/M001/slices/S01/CAMPAIGN.json
      const sliceDir = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01');
      mkdirSync(sliceDir, { recursive: true });
      writeFileSync(join(sliceDir, 'CAMPAIGN.json'), '{}');

      const result = findActiveCampaignDir(dir);
      assert(result !== null, 'findActiveCampaignDir returns non-null');
      assert(result === sliceDir, `findActiveCampaignDir returns correct path: ${result}`);
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // findActiveCampaignDir — returns null for empty structure
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== findActiveCampaignDir — empty structure ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-report-'));
    try {
      mkdirSync(join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S01'), { recursive: true });
      // No CAMPAIGN.json

      const result = findActiveCampaignDir(dir);
      assert(result === null, 'findActiveCampaignDir returns null when no CAMPAIGN.json exists');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // findActiveCampaignDir — returns null for missing .gsd
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== findActiveCampaignDir — no .gsd directory ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-report-'));
    try {
      const result = findActiveCampaignDir(dir);
      assert(result === null, 'findActiveCampaignDir returns null when .gsd does not exist');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // findActiveCampaignDir — picks first alphabetically
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n=== findActiveCampaignDir — picks first match ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-report-'));
    try {
      // Create two campaigns: M001/S02 and M002/S01
      const slice1 = join(dir, '.gsd', 'milestones', 'M001', 'slices', 'S02');
      const slice2 = join(dir, '.gsd', 'milestones', 'M002', 'slices', 'S01');
      mkdirSync(slice1, { recursive: true });
      mkdirSync(slice2, { recursive: true });
      writeFileSync(join(slice1, 'CAMPAIGN.json'), '{}');
      writeFileSync(join(slice2, 'CAMPAIGN.json'), '{}');

      const result = findActiveCampaignDir(dir);
      assert(result === slice1, 'findActiveCampaignDir returns first match (M001/S02)');
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

main();
