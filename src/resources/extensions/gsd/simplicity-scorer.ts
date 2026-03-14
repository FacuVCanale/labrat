/**
 * GSD Simplicity Scorer — Pure functions for computing code simplicity from diff-stat data.
 *
 * Module extraction pattern (D039): pure functions called from eval-runner.ts.
 * No side effects except `extractNumericDiffStat` which shells out to git.
 */

import { spawnSync } from 'node:child_process';
import type { DiffStat, SimplicityScore } from './types.js';

// ─── Diff-Stat Extraction ────────────────────────────────────────────────────

/**
 * Extract numeric diff-stat from git for the most recent commit.
 * Parses `git diff --numstat HEAD~1..HEAD` — tab-separated: added, removed, filename per line.
 * Binary files show `-` for added/removed — treated as 0.
 *
 * Returns zero-churn DiffStat on any failure (non-git dir, first commit, etc.)
 * — this maps to simplicityScore = 1.0 (safe default).
 */
export function extractNumericDiffStat(basePath: string): DiffStat {
  const fallback: DiffStat = { linesAdded: 0, linesRemoved: 0, filesChanged: 0 };

  try {
    const result = spawnSync('git', ['diff', '--numstat', 'HEAD~1..HEAD'], {
      cwd: basePath,
      encoding: 'utf-8',
      timeout: 10_000,
    });

    if (result.status !== 0 || !result.stdout) {
      return fallback;
    }

    const lines = result.stdout.split('\n').filter(l => l.trim());
    if (lines.length === 0) return fallback;

    let linesAdded = 0;
    let linesRemoved = 0;
    let filesChanged = 0;

    for (const line of lines) {
      // Format: "added\tremoved\tfilename"
      // Binary files show: "-\t-\tfilename"
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const removed = parts[1] === '-' ? 0 : parseInt(parts[1], 10);

      if (!isNaN(added)) linesAdded += added;
      if (!isNaN(removed)) linesRemoved += removed;
      filesChanged++;
    }

    return { linesAdded, linesRemoved, filesChanged };
  } catch {
    return fallback;
  }
}

// ─── Simplicity Score Computation ────────────────────────────────────────────

/**
 * Compute a simplicity score from diff-stat data.
 * Score = 1 / (1 + totalChurn) where totalChurn = linesAdded + linesRemoved.
 *
 * - Zero churn → score = 1.0 (maximum simplicity)
 * - Small churn (e.g. 9 lines) → score ≈ 0.1
 * - Large churn (e.g. 999 lines) → score ≈ 0.001
 *
 * Returns a SimplicityScore with the 0–1 score plus raw diff counts.
 */
export function computeSimplicityScore(diffStat: DiffStat): SimplicityScore {
  const totalChurn = diffStat.linesAdded + diffStat.linesRemoved;
  const score = 1 / (1 + totalChurn);

  return {
    score,
    linesAdded: diffStat.linesAdded,
    linesRemoved: diffStat.linesRemoved,
    filesChanged: diffStat.filesChanged,
  };
}
