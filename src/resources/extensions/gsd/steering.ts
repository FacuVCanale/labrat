/**
 * GSD Steering Module — Types, atomic I/O, and facade functions for runtime steering.
 *
 * Module extraction pattern (D039): pure functions called from auto.ts and guided-flow.ts.
 * All steering logic lives here — auto.ts gets only thin facade calls.
 *
 * Files managed:
 * - STEERING.json     — transient directive, consumed and deleted at experiment boundary
 * - STEERING-FOCUS.md — persistent refocus context for prompt injection, survives across experiments
 *
 * Concurrency model (D041/D045): write-to-temp-then-rename for atomic writes.
 * Diagnostic: `cat <slice-dir>/STEERING.json` for pending directives,
 *             `cat <slice-dir>/STEERING-FOCUS.md` for active refocus context.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { SteeringDirective, CampaignConfig } from './types.js';
import {
  readAgendaState,
  writeAgendaState,
  advancePhase,
  getCurrentPhase,
  getPhaseBestMetrics,
} from './agenda.js';
import { readAllExperiments } from './eval-runner.js';

// Re-export type so consumers can import from steering.ts
export type { SteeringDirective };

// ─── File Constants ───────────────────────────────────────────────────────────

export const STEERING_FILE = 'STEERING.json';
export const STEERING_FOCUS_FILE = 'STEERING-FOCUS.md';

// ─── Valid directive types ────────────────────────────────────────────────────

const VALID_DIRECTIVE_TYPES = new Set(['refocus', 'skip_phase', 'stop']);

// ─── Low-level I/O ────────────────────────────────────────────────────────────

/**
 * Read a steering directive from STEERING.json in the slice directory.
 * Returns null on missing/corrupt/invalid-shape file (never throws).
 * Emits stderr warning on corruption for diagnostics.
 */
export function readSteeringDirective(sliceDir: string): SteeringDirective | null {
  const filePath = join(sliceDir, STEERING_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;

    const parsed = JSON.parse(content);

    // Shape validation
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.type !== 'string' ||
      !VALID_DIRECTIVE_TYPES.has(parsed.type) ||
      typeof parsed.message !== 'string' ||
      typeof parsed.timestamp !== 'string'
    ) {
      console.error(`[steering] Corrupt STEERING.json in ${sliceDir} — invalid shape, returning null`);
      return null;
    }

    return parsed as SteeringDirective;
  } catch (err) {
    console.error(`[steering] Corrupt STEERING.json in ${sliceDir} — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Write a steering directive atomically using write-to-temp-then-rename (D045).
 * Crash during write leaves previous valid state intact.
 */
export function writeSteeringDirective(sliceDir: string, directive: SteeringDirective): void {
  const filePath = join(sliceDir, STEERING_FILE);
  const tmpPath = filePath + '.tmp';

  writeFileSync(tmpPath, JSON.stringify(directive, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Delete STEERING.json. No-op if missing.
 */
export function clearSteeringDirective(sliceDir: string): void {
  const filePath = join(sliceDir, STEERING_FILE);
  try {
    unlinkSync(filePath);
  } catch {
    // no-op if missing
  }
}

/**
 * Write STEERING-FOCUS.md with refocus message.
 */
export function writeSteeringFocus(sliceDir: string, message: string): void {
  const filePath = join(sliceDir, STEERING_FOCUS_FILE);
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, message + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Delete STEERING-FOCUS.md. No-op if missing.
 */
export function clearSteeringFocus(sliceDir: string): void {
  const filePath = join(sliceDir, STEERING_FOCUS_FILE);
  try {
    unlinkSync(filePath);
  } catch {
    // no-op if missing
  }
}

/**
 * Read STEERING-FOCUS.md and return formatted markdown section for prompt injection.
 * Returns empty string when no active refocus.
 */
export function getSteeringPromptOverride(sliceDir: string): string {
  const filePath = join(sliceDir, STEERING_FOCUS_FILE);
  if (!existsSync(filePath)) return '';

  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return '';

    return `## Steering Override\n\n${content}\n`;
  } catch {
    return '';
  }
}

// ─── Facade: checkSteeringDirective ───────────────────────────────────────────

export interface SteeringResult {
  notify: string;
  stop?: boolean;
}

/**
 * Facade: read directive → switch on type → apply → return notification.
 *
 * Called from dispatchNextUnit at experiment boundary.
 * - refocus:    write STEERING-FOCUS.md, clear STEERING.json
 * - skip_phase: advance phase via agenda.ts, clear both files
 * - stop:       clear STEERING.json, return stop flag
 *
 * Returns null when no directive is pending.
 */
export function checkSteeringDirective(
  sliceDir: string,
  config: CampaignConfig | null,
): SteeringResult | null {
  const directive = readSteeringDirective(sliceDir);
  if (!directive) return null;

  switch (directive.type) {
    case 'refocus': {
      writeSteeringFocus(sliceDir, directive.message);
      clearSteeringDirective(sliceDir);
      return { notify: `Steering: refocused — ${directive.message}` };
    }

    case 'skip_phase': {
      if (!config?.agenda) {
        console.error('[steering] skip_phase directive on non-agenda campaign — ignoring phase advance');
        clearSteeringDirective(sliceDir);
        return { notify: 'Steering: skip_phase ignored — campaign has no agenda' };
      }

      const agState = readAgendaState(sliceDir);
      if (!agState) {
        console.error('[steering] skip_phase directive but no agenda state found — ignoring');
        clearSteeringDirective(sliceDir);
        return { notify: 'Steering: skip_phase ignored — no agenda state' };
      }

      const currentPhase = getCurrentPhase(agState, config.agenda);
      if (!currentPhase) {
        console.error('[steering] skip_phase directive but all phases already complete — ignoring');
        clearSteeringDirective(sliceDir);
        return { notify: 'Steering: skip_phase ignored — all phases complete' };
      }

      // Get phase metrics from experiments for the advance
      const experiments = readAllExperiments(sliceDir);

      const phaseMetrics = getPhaseBestMetrics(experiments, agState) ?? {};
      const newState = advancePhase(agState, config.agenda, phaseMetrics);
      writeAgendaState(sliceDir, newState);

      const newPhase = getCurrentPhase(newState, config.agenda);
      clearSteeringFocus(sliceDir);
      clearSteeringDirective(sliceDir);

      const phaseName = newPhase?.name ?? 'complete';
      return { notify: `Steering: skipped to phase "${phaseName}"` };
    }

    case 'stop': {
      clearSteeringDirective(sliceDir);
      return { notify: 'Steering: campaign stopped', stop: true };
    }

    default: {
      // Unknown directive type — graceful degradation
      console.error(`[steering] Unknown directive type "${(directive as SteeringDirective).type}" — ignoring`);
      clearSteeringDirective(sliceDir);
      return { notify: `Steering: unknown directive type — ignored` };
    }
  }
}
