/**
 * GSD Agenda Module — Types, state persistence, and phase-transition functions.
 *
 * Module extraction pattern (D039): pure functions called from auto.ts and guided-flow.ts.
 * All agenda logic lives here — auto.ts gets only thin wiring calls.
 *
 * State file: AGENDA-STATE.json in slice directory (atomic writes via D045).
 * Diagnostic: `jq '.' AGENDA-STATE.json` for current phase progress.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AgendaConfig,
  AgendaPhase,
  AgendaState,
  ExperimentPlan,
  ExperimentResult,
} from './types.js';

// Re-export types so consumers can import from agenda.ts
export type { AgendaConfig, AgendaPhase, AgendaState, ExperimentPlan };

const AGENDA_STATE_FILE = 'AGENDA-STATE.json';

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate and parse a raw agenda config object.
 * Returns null on invalid input (graceful degradation pattern).
 *
 * Validates:
 * - phases is a non-empty array
 * - each phase has name (string) and experimentsPerPhase > 0
 * - totalExperiments is a positive number
 * - researchQuestion is a non-empty string
 * - sum of experimentsPerPhase does not exceed maxExperiments when provided
 */
export function parseAgenda(raw: unknown, maxExperiments?: number): AgendaConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;

  // Required: phases array
  if (!Array.isArray(obj.phases) || obj.phases.length === 0) return null;

  // Required: totalExperiments
  if (typeof obj.totalExperiments !== 'number' || obj.totalExperiments <= 0) return null;

  // Required: researchQuestion
  if (typeof obj.researchQuestion !== 'string' || obj.researchQuestion.trim() === '') return null;

  // Validate each phase
  let phaseExperimentSum = 0;
  for (const phase of obj.phases) {
    if (typeof phase !== 'object' || phase === null || Array.isArray(phase)) return null;
    const p = phase as Record<string, unknown>;

    if (typeof p.name !== 'string' || p.name.trim() === '') return null;
    if (typeof p.experimentsPerPhase !== 'number' || p.experimentsPerPhase <= 0) return null;

    // dimension and goal are expected but we degrade gracefully
    if (typeof p.dimension !== 'string') (p as Record<string, unknown>).dimension = '';
    if (typeof p.goal !== 'string') (p as Record<string, unknown>).goal = '';

    phaseExperimentSum += p.experimentsPerPhase;
  }

  // Sum of experimentsPerPhase should not exceed maxExperiments when provided
  if (maxExperiments !== undefined && phaseExperimentSum > maxExperiments) return null;

  return obj as unknown as AgendaConfig;
}

// ─── State I/O ───────────────────────────────────────────────────────────────

/**
 * Read agenda state from AGENDA-STATE.json in the slice directory.
 * Returns null on missing/corrupt file (same pattern as readBestMetrics).
 * Emits stderr warning on corruption for diagnostics.
 */
export function readAgendaState(sliceDir: string): AgendaState | null {
  const filePath = join(sliceDir, AGENDA_STATE_FILE);
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
      typeof parsed.currentPhaseIndex !== 'number' ||
      typeof parsed.phaseResults !== 'object' ||
      typeof parsed.experimentRanges !== 'object' ||
      !Array.isArray(parsed.completedPhases)
    ) {
      console.error(`[agenda] Corrupt AGENDA-STATE.json in ${sliceDir} — invalid shape, returning null`);
      return null;
    }

    return parsed as AgendaState;
  } catch (err) {
    console.error(`[agenda] Corrupt AGENDA-STATE.json in ${sliceDir} — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Write agenda state atomically using write-to-temp-then-rename (D045).
 * Crash during write leaves previous valid state intact.
 */
export function writeAgendaState(sliceDir: string, state: AgendaState): void {
  const filePath = join(sliceDir, AGENDA_STATE_FILE);
  const tmpPath = filePath + '.tmp';

  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Create an initial agenda state for a new agenda.
 * Sets up experiment ranges based on phase configuration.
 */
export function createInitialAgendaState(config: AgendaConfig): AgendaState {
  const experimentRanges: Record<string, { start: number; end: number }> = {};
  let cursor = 1; // experiment numbers are 1-based

  for (const phase of config.phases) {
    experimentRanges[phase.name] = {
      start: cursor,
      end: cursor + phase.experimentsPerPhase - 1,
    };
    cursor += phase.experimentsPerPhase;
  }

  return {
    version: 1,
    currentPhaseIndex: 0,
    phaseResults: {},
    experimentRanges,
    completedPhases: [],
  };
}

// ─── Phase Navigation ────────────────────────────────────────────────────────

/**
 * Get the currently active phase.
 * Returns null if all phases are complete.
 */
export function getCurrentPhase(state: AgendaState, config: AgendaConfig): AgendaPhase | null {
  if (state.currentPhaseIndex >= config.phases.length) return null;
  return config.phases[state.currentPhaseIndex];
}

/**
 * Advance to the next phase, recording metrics and updating state.
 * Returns a new AgendaState (immutable update pattern).
 */
export function advancePhase(
  state: AgendaState,
  config: AgendaConfig,
  phaseMetrics: Record<string, number>,
): AgendaState {
  const currentPhase = getCurrentPhase(state, config);
  if (!currentPhase) return state; // already complete, no-op

  const phaseName = currentPhase.name;

  return {
    ...state,
    currentPhaseIndex: state.currentPhaseIndex + 1,
    phaseResults: {
      ...state.phaseResults,
      [phaseName]: phaseMetrics,
    },
    completedPhases: [...state.completedPhases, phaseName],
  };
}

/**
 * Check whether the current phase has exhausted its experiment budget.
 * Returns true when phaseExperimentCount >= the phase's experimentsPerPhase.
 */
export function shouldAdvancePhase(
  state: AgendaState,
  phaseExperimentCount: number,
  config: AgendaConfig,
): boolean {
  const currentPhase = getCurrentPhase(state, config);
  if (!currentPhase) return false; // all phases complete

  return phaseExperimentCount >= currentPhase.experimentsPerPhase;
}

// ─── T02 Helper Functions ────────────────────────────────────────────────────

/**
 * Format current phase context as a markdown string for prompt injection.
 * Returns empty string when no agenda or all phases complete.
 */
export function getPhaseContext(state: AgendaState, config: AgendaConfig): string {
  const phase = getCurrentPhase(state, config);
  if (!phase) return '';

  const range = state.experimentRanges[phase.name];
  const remaining = range
    ? Math.max(0, range.end - range.start + 1 - (state.completedPhases.length > 0 ? 0 : 0))
    : phase.experimentsPerPhase;

  // Calculate experiments already done in this phase
  const phaseStart = range?.start ?? 1;
  const phaseEnd = range?.end ?? phase.experimentsPerPhase;
  const totalInPhase = phaseEnd - phaseStart + 1;

  const lines = [
    `## Current Phase: ${phase.name}`,
    '',
    `**Goal:** ${phase.goal}`,
    `**Dimension:** ${phase.dimension}`,
    `**Experiments in phase:** ${totalInPhase}`,
    `**Phase ${state.currentPhaseIndex + 1} of ${config.phases.length}**`,
  ];

  if (phase.experimentPlans && phase.experimentPlans.length > 0) {
    lines.push('', '### Experiment Plans:');
    for (const plan of phase.experimentPlans) {
      lines.push(`- **${plan.description}** — Hypothesis: ${plan.hypothesis} (Focus: ${plan.targetFocus})`);
    }
  }

  if (state.currentPhaseIndex > 0 && state.completedPhases.length > 0) {
    const lastPhase = state.completedPhases[state.completedPhases.length - 1];
    const lastMetrics = state.phaseResults[lastPhase];
    if (lastMetrics) {
      lines.push('', `### Previous Phase Results (${lastPhase}):`);
      for (const [key, value] of Object.entries(lastMetrics)) {
        lines.push(`- ${key}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Filter experiments to current phase's range, return best kept metrics.
 * Returns null if no kept experiments in the current phase.
 */
export function getPhaseBestMetrics(
  experiments: ExperimentResult[],
  state: AgendaState,
): Record<string, number> | null {
  const phaseExperiments = getPhaseFilteredHistory(experiments, state);

  // Find the latest kept experiment in this phase
  let bestEntry: ExperimentResult | null = null;
  let bestExpNumber = -1;

  for (const exp of phaseExperiments) {
    if (exp.decision?.decision !== 'keep') continue;

    const match = exp.id?.match(/(\d+)/);
    const expNum = match ? parseInt(match[1], 10) : -1;

    if (expNum > bestExpNumber) {
      bestExpNumber = expNum;
      bestEntry = exp;
    }
  }

  return bestEntry?.metrics ?? null;
}

/**
 * Filter experiments to only those belonging to the current phase.
 * Uses experimentRanges from state to determine which experiments belong.
 */
export function getPhaseFilteredHistory(
  experiments: ExperimentResult[],
  state: AgendaState,
): ExperimentResult[] {
  const phase = Object.keys(state.experimentRanges).find(
    (_, idx) => idx === state.currentPhaseIndex,
  );

  if (!phase) return [];

  const range = state.experimentRanges[phase];
  if (!range) return [];

  return experiments.filter((exp) => {
    const match = exp.id?.match(/(\d+)/);
    if (!match) return false;
    const expNum = parseInt(match[1], 10);
    return expNum >= range.start && expNum <= range.end;
  });
}

// ─── Auto.ts Facade Functions ────────────────────────────────────────────────

/**
 * Check and handle phase boundary in dispatchNextUnit.
 * Returns a notify message if phase advanced, null otherwise.
 * Handles state initialization, boundary detection, advance, and persistence.
 */
export function checkAndAdvancePhase(
  sliceDir: string,
  agenda: AgendaConfig,
  expNum: number,
  experiments: ExperimentResult[],
): string | null {
  let agState = readAgendaState(sliceDir);
  if (!agState) { agState = createInitialAgendaState(agenda); writeAgendaState(sliceDir, agState); }
  const phase = getCurrentPhase(agState, agenda);
  if (!phase) return null;
  const range = agState.experimentRanges[phase.name];
  const phaseExpCount = range ? Math.max(0, expNum - range.start) : 0;
  if (!shouldAdvancePhase(agState, phaseExpCount, agenda)) return null;
  const phaseMetrics = getPhaseBestMetrics(experiments, agState) ?? {};
  agState = advancePhase(agState, agenda, phaseMetrics);
  writeAgendaState(sliceDir, agState);
  const newPhase = getCurrentPhase(agState, agenda);
  return `Phase ${agState.currentPhaseIndex} → Phase ${agState.currentPhaseIndex + 1}: ${newPhase?.name ?? 'complete'}`;
}

/**
 * Build phase-aware prompt overrides for buildExperimentPrompt.
 * Returns { phaseContext, experiments, bestMetrics } scoped to current phase.
 */
export function getPhasePromptOverrides(
  sliceDir: string,
  agenda: AgendaConfig,
  allExperiments: ExperimentResult[],
  globalBestMetrics: Record<string, number> | null,
): { phaseContext: string; experiments: ExperimentResult[]; bestMetrics: Record<string, number> | null } {
  const agState = readAgendaState(sliceDir);
  if (!agState) return { phaseContext: '', experiments: allExperiments, bestMetrics: globalBestMetrics };
  const phaseContext = getPhaseContext(agState, agenda);
  const phaseFiltered = getPhaseFilteredHistory(allExperiments, agState);
  const phaseBest = getPhaseBestMetrics(allExperiments, agState);
  return {
    phaseContext,
    experiments: phaseFiltered.length > 0 ? phaseFiltered : allExperiments,
    bestMetrics: phaseBest ?? globalBestMetrics,
  };
}

/**
 * Stamp phaseIndex on an experiment result and patch the JSONL log.
 * Non-fatal — returns silently on any error.
 */
export function stampPhaseIndex(sliceDir: string, result: ExperimentResult): void {
  const agState = readAgendaState(sliceDir);
  if (!agState) return;
  result.phaseIndex = agState.currentPhaseIndex;
  const logPath = join(sliceDir, 'EXPERIMENT-LOG.jsonl');
  try {
    const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    lines[lines.length - 1] = JSON.stringify(result);
    writeFileSync(logPath, lines.join('\n') + '\n');
  } catch { /* non-fatal */ }
}
