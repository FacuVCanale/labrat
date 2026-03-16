/**
 * GSD Hypothesis State Module — Types, state persistence, and phase-transition functions.
 *
 * Follows the agenda.ts pattern (D039): pure functions called from auto.ts.
 * State file: HYPOTHESIS-STATE.json in slice directory (atomic writes via D045).
 * Diagnostic: `jq '.' HYPOTHESIS-STATE.json` for current sub-phase and experiment number.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { ExperimentResult } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HypothesisSubPhase = 'research' | 'plan' | 'execute' | 'verify';

export interface HypothesisState {
  version: 1;
  subPhase: HypothesisSubPhase;
  experimentNumber: number;
  completedPhases: string[];
}

const HYPOTHESIS_STATE_FILE = 'HYPOTHESIS-STATE.json';

// ─── State I/O ───────────────────────────────────────────────────────────────

/**
 * Read hypothesis state from HYPOTHESIS-STATE.json in the slice directory.
 * Returns null on missing/corrupt file (same pattern as readAgendaState).
 * Emits stderr warning on corruption for diagnostics.
 */
export function readHypothesisState(sliceDir: string): HypothesisState | null {
  const filePath = join(sliceDir, HYPOTHESIS_STATE_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;

    const parsed = JSON.parse(content);

    // Minimal shape validation
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'number' ||
      typeof parsed.subPhase !== 'string' ||
      !['research', 'plan', 'execute', 'verify'].includes(parsed.subPhase) ||
      typeof parsed.experimentNumber !== 'number' ||
      !Array.isArray(parsed.completedPhases)
    ) {
      process.stderr.write(`[hypothesis] Corrupt HYPOTHESIS-STATE.json in ${sliceDir} — invalid shape, returning null\n`);
      return null;
    }

    return parsed as HypothesisState;
  } catch (err) {
    process.stderr.write(`[hypothesis] Corrupt HYPOTHESIS-STATE.json in ${sliceDir} — ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/**
 * Write hypothesis state atomically using write-to-temp-then-rename (D045).
 * Crash during write leaves previous valid state intact.
 */
export function writeHypothesisState(sliceDir: string, state: HypothesisState): void {
  const filePath = join(sliceDir, HYPOTHESIS_STATE_FILE);
  const tmpPath = filePath + '.tmp';

  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Create an initial hypothesis state for a new hypothesis.
 */
export function createInitialHypothesisState(): HypothesisState {
  return {
    version: 1,
    subPhase: 'research',
    experimentNumber: 1,
    completedPhases: [],
  };
}

// ─── Phase Transitions ───────────────────────────────────────────────────────

/**
 * Advance hypothesis sub-phase and persist.
 * Transitions: research→plan, plan→execute, execute→verify,
 * verify→plan (with experimentNumber++) or done.
 *
 * Returns the new state, or null if hypothesis is complete (verify with no more experiments).
 */
export function advanceHypothesisPhase(
  sliceDir: string,
  fromPhase: HypothesisSubPhase,
  maxExperiments?: number,
): HypothesisState | null {
  let state = readHypothesisState(sliceDir);
  if (!state) {
    state = createInitialHypothesisState();
  }

  const prevPhase = state.subPhase;

  switch (fromPhase) {
    case 'research':
      state = { ...state, subPhase: 'plan', completedPhases: [...state.completedPhases, 'research'] };
      break;
    case 'plan':
      state = { ...state, subPhase: 'execute', completedPhases: [...state.completedPhases, `plan-E${state.experimentNumber}`] };
      break;
    case 'execute':
      state = { ...state, subPhase: 'verify', completedPhases: [...state.completedPhases, `execute-E${state.experimentNumber}`] };
      break;
    case 'verify': {
      const nextExpNum = state.experimentNumber + 1;
      // If max experiments reached, hypothesis is done
      if (maxExperiments !== undefined && nextExpNum > maxExperiments) {
        state = {
          ...state,
          subPhase: 'verify', // remains at verify (terminal)
          completedPhases: [...state.completedPhases, `verify-E${state.experimentNumber}`, 'done'],
        };
        writeHypothesisState(sliceDir, state);
        process.stderr.write(`[hypothesis] phase → done (all ${maxExperiments} experiments completed)\n`);
        return null;
      }
      // Cycle back to plan for next experiment
      state = {
        ...state,
        subPhase: 'plan',
        experimentNumber: nextExpNum,
        completedPhases: [...state.completedPhases, `verify-E${state.experimentNumber}`],
      };
      break;
    }
  }

  writeHypothesisState(sliceDir, state);
  process.stderr.write(`[hypothesis] phase → ${state.subPhase} (from ${prevPhase}, experiment ${state.experimentNumber})\n`);
  return state;
}

// ─── Result Formatting ───────────────────────────────────────────────────────

/**
 * Convert an ExperimentResult to a readable markdown string
 * for the verify prompt's `currentResults` parameter.
 */
export function formatResultsForVerify(result: ExperimentResult): string {
  const lines: string[] = [
    `## Experiment ${result.id} Results`,
    '',
    `**Decision:** ${result.decision.decision} — ${result.decision.reason}`,
    `**Duration:** ${(result.duration / 1000).toFixed(1)}s`,
    `**Cost:** $${result.cost.toFixed(4)}`,
    '',
    '### Metrics',
    '',
  ];

  for (const [key, value] of Object.entries(result.metrics)) {
    lines.push(`- **${key}:** ${typeof value === 'number' ? value.toFixed(4) : value}`);
  }

  if (result.simplicityScore) {
    lines.push('', '### Simplicity Score', '');
    lines.push(`- **Score:** ${result.simplicityScore.score}`);
    if (result.simplicityScore.explanation) {
      lines.push(`- **Explanation:** ${result.simplicityScore.explanation}`);
    }
  }

  lines.push('', '### Description', '', result.description);

  if (result.diff) {
    lines.push('', '### Changes', '', '```diff', result.diff, '```');
  }

  return lines.join('\n');
}
