/**
 * GSD Morning Report — Pure terminal report formatter.
 *
 * `generateMorningReport()` takes experiment data, campaign config, cost data,
 * and dashboard URL as inputs and produces a formatted terminal string.
 * Pure function — no I/O, just string assembly — fully contract-testable.
 *
 * `findActiveCampaignDir()` scans milestone and slice directories for
 * CAMPAIGN.json and returns the first campaign directory found.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExperimentResult, CampaignConfig } from './types.js';
import type { UnitMetrics } from './metrics.js';
import { formatCost, formatTokenCount, getProjectTotals } from './metrics.js';
import { computeCompositeScore } from './eval-runner.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MorningReportInput {
  experiments: ExperimentResult[];
  campaign: CampaignConfig;
  ledgerUnits: UnitMetrics[] | null;
  dashboardUrl: string | null;
  useColor: boolean;
}

// ─── Color Helpers ──────────────────────────────────────────────────────────

interface ColorFns {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  yellow: (s: string) => string;
}

function makeColors(useColor: boolean): ColorFns {
  if (!useColor) {
    const id = (s: string) => s;
    return { bold: id, dim: id, green: id, red: id, cyan: id, yellow: id };
  }
  return {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  };
}

// ─── Report Generator ───────────────────────────────────────────────────────

/**
 * Generate a formatted terminal report from experiment data.
 * Pure function — takes data in, returns string out, no file I/O.
 */
export function generateMorningReport(input: MorningReportInput): string {
  const { experiments, campaign, ledgerUnits, dashboardUrl, useColor } = input;
  const c = makeColors(useColor);
  const lines: string[] = [];

  // ── Campaign Header ──
  lines.push(c.bold(`═══ Campaign: ${campaign.name} ═══`));
  if (campaign.researchQuestion) {
    lines.push(`Research question: ${campaign.researchQuestion}`);
  }
  if (campaign.targetFiles.length > 0) {
    lines.push(`Target files: ${campaign.targetFiles.join(', ')}`);
  }
  lines.push('');

  // ── Edge case: no experiments ──
  if (experiments.length === 0) {
    lines.push(c.yellow('No experiments have been run yet. Start experimenting!'));
    if (dashboardUrl) {
      lines.push('');
      lines.push(`Dashboard: ${c.cyan(dashboardUrl)}`);
    }
    return lines.join('\n');
  }

  // ── Experiment Summary ──
  const kept = experiments.filter(e => e.decision?.decision === 'keep');
  const discarded = experiments.filter(e => e.decision?.decision === 'discard');
  lines.push(c.bold('── Experiment Summary ──'));
  lines.push(`Total: ${experiments.length}  |  ${c.green(`Kept: ${kept.length}`)}  |  ${c.red(`Discarded: ${discarded.length}`)}`);
  lines.push('');

  // ── Top Experiments (ranked by composite score) ──
  const baseline = kept.length > 0 ? kept[0].metrics : {};
  const metricDefs = campaign.evalConfig.metrics;
  const scored = experiments
    .map(exp => ({
      exp,
      score: computeCompositeScore(exp.metrics, baseline, metricDefs),
    }))
    .sort((a, b) => b.score - a.score);

  lines.push(c.bold('── Top Experiments ──'));

  const topN = scored.slice(0, 10);
  for (const { exp, score } of topN) {
    const decision = exp.decision?.decision === 'keep' ? c.green('keep') : c.red('discard');
    const descSnippet = exp.description
      ? exp.description.slice(0, 50) + (exp.description.length > 50 ? '…' : '')
      : '';
    const metricStr = Object.entries(exp.metrics)
      .map(([name, val]) => `${name}=${val.toFixed(4)}`)
      .join(' ');
    lines.push(
      `  ${exp.id}  ${c.dim(descSnippet.padEnd(52))}  ${metricStr}  score=${score.toFixed(4)}  [${decision}]`
    );
  }
  if (scored.length > 10) {
    lines.push(c.dim(`  ... and ${scored.length - 10} more`));
  }
  lines.push('');

  // ── Improvement Trajectory ──
  if (kept.length >= 2) {
    const firstKept = kept[0];
    const bestKept = kept[kept.length - 1];

    lines.push(c.bold('── Improvement Trajectory ──'));
    lines.push(`First kept (${firstKept.id}) → Best kept (${bestKept.id})`);

    for (const def of metricDefs) {
      const first = firstKept.metrics[def.name];
      const best = bestKept.metrics[def.name];
      if (first !== undefined && best !== undefined) {
        const improved = def.direction === 'max' ? best > first : best < first;
        const arrow = improved ? c.green('↑') : (best === first ? '→' : c.red('↓'));
        const delta = best - first;
        const sign = delta >= 0 ? '+' : '';
        lines.push(`  ${def.name}: ${first.toFixed(4)} → ${best.toFixed(4)} (${sign}${delta.toFixed(4)}) ${arrow}`);
      }
    }
    lines.push('');
  }

  // ── Cost Breakdown ──
  if (ledgerUnits && ledgerUnits.length > 0) {
    const totals = getProjectTotals(ledgerUnits);
    lines.push(c.bold('── Cost Breakdown ──'));
    lines.push(`Total cost: ${formatCost(totals.cost)}`);
    lines.push(`Avg per experiment: ${formatCost(totals.cost / experiments.length)}`);
    lines.push(`Total tokens: ${formatTokenCount(totals.tokens.total)}`);
    lines.push(`Tool calls: ${totals.toolCalls}  |  Messages: ${totals.assistantMessages} assistant, ${totals.userMessages} user`);
    lines.push('');
  }

  // ── Duration ──
  const timestamps = experiments
    .filter(e => e.timestamp)
    .map(e => new Date(e.timestamp!).getTime())
    .filter(t => !isNaN(t));

  if (timestamps.length >= 2) {
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    const durationMs = latest - earliest;
    const durationMins = Math.round(durationMs / 60_000);

    lines.push(c.bold('── Duration ──'));
    lines.push(`Earliest: ${new Date(earliest).toISOString()}`);
    lines.push(`Latest:   ${new Date(latest).toISOString()}`);
    lines.push(`Span: ${durationMins} minutes`);
    lines.push('');
  }

  // ── Dashboard Link ──
  if (dashboardUrl) {
    lines.push(`Dashboard: ${c.cyan(dashboardUrl)}`);
  }

  return lines.join('\n');
}

// ─── Campaign Directory Scanner ─────────────────────────────────────────────

/**
 * Scan .gsd/milestones/{M}/slices/{S}/CAMPAIGN.json and return the first
 * campaign directory found. Returns null if no campaign is found.
 *
 * @param basePath - The project root directory
 * @returns The slice directory containing CAMPAIGN.json, or null
 */
export function findActiveCampaignDir(basePath: string): string | null {
  const gsdDir = join(basePath, '.gsd');
  if (!existsSync(gsdDir)) return null;

  const milestonesPath = join(gsdDir, 'milestones');
  if (!existsSync(milestonesPath)) return null;

  let milestoneDirs: string[];
  try {
    milestoneDirs = readdirSync(milestonesPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    return null;
  }

  for (const mDir of milestoneDirs) {
    const slicesPath = join(milestonesPath, mDir, 'slices');
    if (!existsSync(slicesPath)) continue;

    let sliceDirs: string[];
    try {
      sliceDirs = readdirSync(slicesPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
    } catch {
      continue;
    }

    for (const sDir of sliceDirs) {
      const campaignFile = join(slicesPath, sDir, 'CAMPAIGN.json');
      if (existsSync(campaignFile)) {
        return join(slicesPath, sDir);
      }
    }
  }

  return null;
}
