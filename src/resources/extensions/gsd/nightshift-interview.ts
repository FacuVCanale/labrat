/**
 * NightShift Interview & Scaffold Generator
 *
 * Interactive wizard that collects research campaign parameters and generates
 * a parser-compatible scaffold with hypothesis-slices and experiment-tasks.
 *
 * Key contract: generated output MUST roundtrip through:
 *   - parseRoadmapSlices() — roadmap-slices.ts
 *   - parsePlan()          — files.ts
 *   - parseCampaignConfig() — state.ts
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { showNextAction } from "../shared/next-action-ui.js";
import { startAuto } from "./auto.js";
import { ensureGitignore, ensurePreferences, untrackRuntimeFiles } from "./gitignore.js";
import { loadEffectiveGSDPreferences } from "./preferences.js";
import { gsdRoot } from "./paths.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NightShiftMetric {
  name: string;
  direction: "min" | "max";
  weight: number;
}

export interface NightShiftInterviewResult {
  targetFiles: string[];
  evalCommand: string;
  metrics: NightShiftMetric[];
  priors?: string;
  hypothesisCount: number;
  experimentsPerHypothesis: number;
}

// ─── Scaffold Generator (pure function — fs writes only) ────────────────────

/**
 * Generate a NightShift research scaffold at `basePath`.
 *
 * Creates:
 *   .gsd/milestones/M001/M001-ROADMAP.md   — hypothesis-slices
 *   .gsd/milestones/M001/slices/S0N/S0N-PLAN.md   — experiment-tasks per slice
 *   .gsd/milestones/M001/slices/S0N/CAMPAIGN.json  — campaign config per slice
 *   .gsd/milestones/M001/slices/S0N/PRIORS.md       — optional priors
 *
 * Output format must match parseRoadmapSlices, parsePlan, and parseCampaignConfig.
 */
export function generateNightShiftScaffold(
  basePath: string,
  config: NightShiftInterviewResult,
): void {
  const gsd = gsdRoot(basePath);
  const milestoneDir = join(gsd, "milestones", "M001");
  mkdirSync(milestoneDir, { recursive: true });

  // ── Build roadmap ──────────────────────────────────────────────────────
  const roadmapLines: string[] = [
    "# M001 Roadmap",
    "",
    "## Slices",
    "",
  ];

  for (let i = 1; i <= config.hypothesisCount; i++) {
    const sliceId = padId("S", i);
    roadmapLines.push(
      `- [ ] **${sliceId}: Hypothesis ${i}** \`risk:medium\` \`depends:[]\``,
    );
    roadmapLines.push(`  > After this: results from hypothesis ${i} experiments`);
  }
  roadmapLines.push("");

  writeFileSync(
    join(milestoneDir, "M001-ROADMAP.md"),
    roadmapLines.join("\n"),
  );

  // ── Build per-slice artifacts ──────────────────────────────────────────
  for (let i = 1; i <= config.hypothesisCount; i++) {
    const sliceId = padId("S", i);
    const sliceDir = join(milestoneDir, "slices", sliceId);
    mkdirSync(sliceDir, { recursive: true });

    // Plan with experiment-tasks
    const planLines: string[] = [
      "---",
      "status: in_progress",
      "---",
      "",
      `# ${sliceId}: Hypothesis ${i}`,
      "",
      `**Goal:** Test hypothesis ${i} via automated experimentation with NightShift.`,
      "",
      "## Tasks",
      "",
    ];

    for (let j = 1; j <= config.experimentsPerHypothesis; j++) {
      const taskId = padId("T", j);
      planLines.push(`- [ ] **${taskId}: Experiment ${j}** \`est:15m\``);
    }
    planLines.push("");

    writeFileSync(
      join(sliceDir, `${sliceId}-PLAN.md`),
      planLines.join("\n"),
    );

    // CAMPAIGN.json
    const campaign = {
      name: `Hypothesis ${i} — NightShift research`,
      researchQuestion: `Hypothesis ${i}: What improvements can NightShift discover?`,
      targetFiles: config.targetFiles,
      evalConfig: {
        command: config.evalCommand,
        timeout: 120,
        metrics: config.metrics.map((m) => ({
          name: m.name,
          direction: m.direction,
          weight: m.weight,
        })),
        runs: 1,
      },
      maxExperiments: config.experimentsPerHypothesis,
      budgetPerExperiment: 1.0,
      ...(config.priors ? { priors: config.priors } : {}),
    };

    writeFileSync(
      join(sliceDir, "CAMPAIGN.json"),
      JSON.stringify(campaign, null, 2) + "\n",
    );

    // Optional PRIORS.md
    if (config.priors) {
      writeFileSync(
        join(sliceDir, "PRIORS.md"),
        `# Prior Knowledge\n\n${config.priors}\n`,
      );
    }
  }
}

// ─── Interview Flow ─────────────────────────────────────────────────────────

/**
 * Interactive wizard that collects research campaign parameters
 * and generates a NightShift scaffold.
 */
export async function showNightShiftInterview(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  basePath: string,
): Promise<void> {
  // ── Git init if needed ────────────────────────────────────────────────
  try {
    execSync("git rev-parse --git-dir", { cwd: basePath, stdio: "pipe" });
  } catch {
    const mainBranch =
      loadEffectiveGSDPreferences()?.preferences?.git?.main_branch || "main";
    execFileSync("git", ["init", "-b", mainBranch], {
      cwd: basePath,
      stdio: "pipe",
    });
  }

  // ── Bootstrap .gsd/ and .gitignore ────────────────────────────────────
  ensureGitignore(basePath);
  untrackRuntimeFiles(basePath);

  if (!existsSync(join(basePath, ".gsd"))) {
    const gsd = gsdRoot(basePath);
    mkdirSync(join(gsd, "milestones"), { recursive: true });
    ensurePreferences(basePath);
    try {
      execSync("git add -A .gsd .gitignore && git commit -m 'chore: init nightshift'", {
        cwd: basePath,
        stdio: "pipe",
      });
    } catch {
      // nothing to commit
    }
  }

  ctx.ui.notify("NightShift Research Interview — press Escape at any prompt to cancel.", "info");

  // ── Collect target files ──────────────────────────────────────────────
  const targetFilesInput = await ctx.ui.input(
    "Target files to optimize (comma-separated paths):",
    "e.g. src/model.py, src/train.py",
  );
  if (targetFilesInput === null || targetFilesInput === undefined) {
    ctx.ui.notify("NightShift interview cancelled.", "warning");
    return;
  }
  const targetFiles = targetFilesInput
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (targetFiles.length === 0) {
    ctx.ui.notify("No target files provided — interview cancelled.", "warning");
    return;
  }

  // ── Collect eval command ──────────────────────────────────────────────
  const evalCommand = await ctx.ui.input(
    "Evaluation command (runs after each experiment):",
    "e.g. python eval.py",
  );
  if (evalCommand === null || evalCommand === undefined) {
    ctx.ui.notify("NightShift interview cancelled.", "warning");
    return;
  }
  if (!evalCommand.trim()) {
    ctx.ui.notify("No eval command provided — interview cancelled.", "warning");
    return;
  }

  // ── Collect metrics (loop) ────────────────────────────────────────────
  const metrics: NightShiftMetric[] = [];

  let addMore = true;
  while (addMore) {
    const metricName = await ctx.ui.input(
      `Metric ${metrics.length + 1} name:`,
      "e.g. accuracy, loss, latency",
    );
    if (metricName === null || metricName === undefined) {
      ctx.ui.notify("NightShift interview cancelled.", "warning");
      return;
    }
    if (!metricName.trim()) {
      ctx.ui.notify("Empty metric name — skipping.", "warning");
      break;
    }

    const direction = await ctx.ui.select(
      `Optimize "${metricName.trim()}" direction:`,
      ["max", "min"],
    );
    if (direction === null || direction === undefined) {
      ctx.ui.notify("NightShift interview cancelled.", "warning");
      return;
    }

    const weightInput = await ctx.ui.input(
      `Weight for "${metricName.trim()}" (0-1):`,
      "1.0",
    );
    if (weightInput === null || weightInput === undefined) {
      ctx.ui.notify("NightShift interview cancelled.", "warning");
      return;
    }
    const weight = parseFloat(weightInput) || 1.0;

    metrics.push({
      name: metricName.trim(),
      direction: direction as "min" | "max",
      weight,
    });

    const addAnother = await ctx.ui.select(
      "Add another metric?",
      ["No", "Yes"],
    );
    if (addAnother === null || addAnother === undefined) {
      ctx.ui.notify("NightShift interview cancelled.", "warning");
      return;
    }
    addMore = addAnother === "Yes";
  }

  if (metrics.length === 0) {
    ctx.ui.notify("No metrics defined — interview cancelled.", "warning");
    return;
  }

  // ── Collect optional priors ───────────────────────────────────────────
  const priorsInput = await ctx.ui.input(
    "Prior knowledge or context (optional — press Enter to skip):",
    "",
  );
  if (priorsInput === null || priorsInput === undefined) {
    ctx.ui.notify("NightShift interview cancelled.", "warning");
    return;
  }
  const priors = priorsInput.trim() || undefined;

  // ── Collect hypothesis count ──────────────────────────────────────────
  const hypothesisInput = await ctx.ui.input(
    "Number of hypotheses to explore (default: 3):",
    "3",
  );
  if (hypothesisInput === null || hypothesisInput === undefined) {
    ctx.ui.notify("NightShift interview cancelled.", "warning");
    return;
  }
  const hypothesisCount = Math.max(1, parseInt(hypothesisInput, 10) || 3);

  // ── Collect experiments per hypothesis ────────────────────────────────
  const experimentsInput = await ctx.ui.input(
    "Experiments per hypothesis (default: 10):",
    "10",
  );
  if (experimentsInput === null || experimentsInput === undefined) {
    ctx.ui.notify("NightShift interview cancelled.", "warning");
    return;
  }
  const experimentsPerHypothesis = Math.max(1, parseInt(experimentsInput, 10) || 10);

  // ── Generate scaffold ─────────────────────────────────────────────────
  const config: NightShiftInterviewResult = {
    targetFiles,
    evalCommand: evalCommand.trim(),
    metrics,
    priors,
    hypothesisCount,
    experimentsPerHypothesis,
  };

  generateNightShiftScaffold(basePath, config);

  // ── Git add + commit ──────────────────────────────────────────────────
  try {
    execSync("git add -A .gsd && git commit -m 'feat: NightShift research scaffold'", {
      cwd: basePath,
      stdio: "pipe",
    });
  } catch {
    // nothing to commit or git not configured
  }

  // ── Offer next action ─────────────────────────────────────────────────
  const choice = await showNextAction(ctx as any, {
    title: "NightShift research scaffold created",
    summary: [
      `${hypothesisCount} hypothesis-slices × ${experimentsPerHypothesis} experiments each`,
      `Target files: ${targetFiles.join(", ")}`,
      `Eval command: ${evalCommand.trim()}`,
      `Metrics: ${metrics.map((m) => `${m.name} (${m.direction})`).join(", ")}`,
    ],
    actions: [
      {
        id: "auto",
        label: "Start auto-mode",
        description: "Begin running experiments automatically with NightShift.",
        recommended: true,
      },
      {
        id: "manual",
        label: "Continue manually",
        description: "Review the scaffold and run experiments yourself.",
      },
    ],
    notYetMessage: "Run /nightshift auto when ready.",
  });

  if (choice === "auto") {
    await startAuto(ctx, pi, basePath);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Pad a numeric ID with a prefix: S1→S01, S10→S10 */
function padId(prefix: string, n: number): string {
  return `${prefix}${n < 10 ? "0" : ""}${n}`;
}
