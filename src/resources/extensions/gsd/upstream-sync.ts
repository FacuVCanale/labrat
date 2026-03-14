/**
 * GSD Upstream Sync — Change detection, classification, and sync reporting.
 *
 * Module extraction pattern (D039): pure functions, zero imports from auto.ts,
 * eval-runner.ts, or campaign lifecycle (D055).
 *
 * File-path-primary classification (D053): each commit is categorized as
 * infrastructure / development-specific / mixed based on which files it touches.
 *
 * Atomic state writes (D054/D045): write-to-temp-then-rename for UPSTREAM-SYNC.json.
 *
 * Diagnostic: `cat .gsd/UPSTREAM-SYNC.json` for sync state,
 *             `generateSyncReport()` output for categorized commit listing.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { runGit } from './git-service.js';
import type { CommitCategory, UpstreamCommitInfo, SyncState } from './types.js';

// Re-export types for consumer convenience
export type { CommitCategory, UpstreamCommitInfo, SyncState };

// ─── Constants ──────────────────────────────────────────────────────────────

const SYNC_STATE_FILE = 'UPSTREAM-SYNC.json';
const SYNC_STATE_DIR = '.gsd';

const DEFAULT_SYNC_STATE: SyncState = {
  lastFetchedUpstream: '',
  evaluatedCommits: [],
  appliedCommits: [],
  version: 1,
};

// ─── File-Path Classification Rules (D053) ──────────────────────────────────

/**
 * Files known to be added by Labrat (not present in upstream GSD-2).
 * Commits touching ONLY these files are development-specific.
 */
const LABRAT_ADDED_FILES = new Set([
  'agenda.ts',
  'steering.ts',
  'simplicity-scorer.ts',
  'eval-runner.ts',
  'mlops-integration.ts',
  'morning-report.ts',
]);

/** Prefix for Labrat-added prompt files */
const LABRAT_PROMPTS_PREFIX = 'prompts/';

/** Prefix for infrastructure-only paths (upstream package structure) */
const INFRASTRUCTURE_PREFIXES = [
  'packages/',
];

/** Prefix for Labrat test files (development-specific) */
const LABRAT_TEST_PREFIX = 'src/resources/extensions/gsd/tests/';

/**
 * Shared files that exist in both upstream and Labrat.
 * These require per-file analysis — a commit touching these is potentially
 * relevant to Labrat and triggers 'mixed' when combined with other categories.
 */
const SHARED_FILES = new Set([
  'auto.ts',
  'commands.ts',
  'state.ts',
  'git-service.ts',
  'types.ts',
  'cli.ts',
  'index.ts',
]);

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Classify a single file path as infrastructure, development-specific, or shared.
 * Returns 'shared' for files that need further analysis in the commit context.
 */
function classifyFile(filePath: string): 'infrastructure' | 'development-specific' | 'shared' {
  // Normalize: strip leading src/resources/extensions/gsd/ to get bare filename
  const bare = filePath.replace(/^src\/resources\/extensions\/gsd\//, '');

  // Labrat test files → development-specific
  if (filePath.startsWith(LABRAT_TEST_PREFIX)) {
    return 'development-specific';
  }

  // Labrat-added files → development-specific
  if (LABRAT_ADDED_FILES.has(bare)) {
    return 'development-specific';
  }

  // Labrat prompts directory → development-specific
  if (bare.startsWith(LABRAT_PROMPTS_PREFIX)) {
    return 'development-specific';
  }

  // Infrastructure prefixes → infrastructure
  for (const prefix of INFRASTRUCTURE_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return 'infrastructure';
    }
  }

  // Shared files → needs per-file analysis
  if (SHARED_FILES.has(bare)) {
    return 'shared';
  }

  // Unknown files default to infrastructure (conservative — assume upstream-relevant)
  return 'infrastructure';
}

/**
 * Categorize a commit based on its changed files using file-path-primary rules.
 *
 * Rules:
 * - All files are infrastructure → 'infrastructure'
 * - All files are development-specific → 'development-specific'
 * - Mix of infrastructure/shared and dev-specific → 'mixed'
 * - Shared files only → 'infrastructure' (conservative: treat as upstream-relevant)
 * - No files → 'infrastructure' (e.g. merge commits)
 */
export function categorizeCommit(commit: Pick<UpstreamCommitInfo, 'filesChanged' | 'subject'>): CommitCategory {
  if (commit.filesChanged.length === 0) {
    return 'infrastructure';
  }

  let hasInfra = false;
  let hasDev = false;
  let hasShared = false;

  for (const file of commit.filesChanged) {
    const cls = classifyFile(file);
    if (cls === 'infrastructure') hasInfra = true;
    else if (cls === 'development-specific') hasDev = true;
    else hasShared = true;
  }

  // Pure dev-specific
  if (hasDev && !hasInfra && !hasShared) {
    return 'development-specific';
  }

  // Pure infrastructure (including shared-only → conservative infrastructure)
  if (!hasDev && (hasInfra || hasShared)) {
    return 'infrastructure';
  }

  // Mix of dev + infra/shared
  return 'mixed';
}

// ─── Upstream Commit Fetching ───────────────────────────────────────────────

/** Git log format: hash, subject, author, date separated by a delimiter */
const LOG_DELIMITER = '‖';
const LOG_FORMAT = `%H${LOG_DELIMITER}%s${LOG_DELIMITER}%an${LOG_DELIMITER}%aI`;

/**
 * Fetch upstream commits with changed file lists.
 *
 * Uses `git log --format=... --name-only upstream/main` to get commits.
 * When `sinceCommit` is provided, only returns commits after that hash.
 *
 * Returns commits in reverse chronological order (newest first).
 */
export function fetchUpstreamCommits(basePath: string, sinceCommit?: string): UpstreamCommitInfo[] {
  const range = sinceCommit ? `${sinceCommit}..upstream/main` : 'upstream/main';

  const raw = runGit(basePath, [
    'log',
    '--format=' + LOG_FORMAT,
    '--name-only',
    range,
  ], { allowFailure: true });

  if (!raw) return [];

  return parseGitLog(raw);
}

/**
 * Parse raw `git log --name-only` output into structured commit info.
 * Each commit block: format line, blank line, file paths, blank line.
 */
export function parseGitLog(raw: string): UpstreamCommitInfo[] {
  const commits: UpstreamCommitInfo[] = [];
  const lines = raw.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    // Skip empty lines between commits
    if (!line) {
      i++;
      continue;
    }

    // Try to parse as a commit header (contains delimiter)
    if (!line.includes(LOG_DELIMITER)) {
      i++;
      continue;
    }

    const parts = line.split(LOG_DELIMITER);
    if (parts.length < 4) {
      i++;
      continue;
    }

    const [hash, subject, author, date] = parts as [string, string, string, string];

    // Skip blank line between format line and file names
    // (git log --name-only inserts a blank line after the format output)
    i++;
    if (i < lines.length && lines[i]!.trim() === '') {
      i++;
    }

    // Collect file names until next blank line or next commit header
    const filesChanged: string[] = [];
    while (i < lines.length) {
      const fileLine = lines[i]!.trim();
      if (!fileLine) {
        i++;
        break;
      }
      // If it looks like another commit header, stop
      if (fileLine.includes(LOG_DELIMITER)) {
        break;
      }
      filesChanged.push(fileLine);
      i++;
    }

    const commit: UpstreamCommitInfo = {
      hash,
      subject,
      author,
      date,
      filesChanged,
      category: 'infrastructure', // placeholder, set below
      conflictFiles: [],
    };

    commit.category = categorizeCommit(commit);
    commits.push(commit);
  }

  return commits;
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

/** Cache for Labrat-modified files (computed once per basePath) */
const labratFilesCache = new Map<string, Set<string>>();

/**
 * Get files that Labrat has modified since the fork point from upstream.
 * Cached per basePath for efficiency across multiple commit checks.
 */
export function getLabratModifiedFiles(basePath: string): Set<string> {
  const cached = labratFilesCache.get(basePath);
  if (cached) return cached;

  // Find the fork point between HEAD and upstream/main
  const forkPoint = runGit(basePath, [
    'merge-base', 'HEAD', 'upstream/main',
  ], { allowFailure: true });

  if (!forkPoint) {
    // No common ancestor — can't determine modifications
    const empty = new Set<string>();
    labratFilesCache.set(basePath, empty);
    return empty;
  }

  const diff = runGit(basePath, [
    'diff', '--name-only', `${forkPoint}..HEAD`,
  ], { allowFailure: true });

  const files = new Set(
    diff ? diff.split('\n').filter(Boolean) : [],
  );

  labratFilesCache.set(basePath, files);
  return files;
}

/**
 * Clear the Labrat-modified files cache (useful in tests).
 */
export function clearLabratFilesCache(): void {
  labratFilesCache.clear();
}

/**
 * Compare a commit's changed files against Labrat's modifications.
 * Returns the list of files that both the commit and Labrat have modified.
 */
export function getConflictFiles(basePath: string, commitFiles: string[]): string[] {
  const labratFiles = getLabratModifiedFiles(basePath);
  return commitFiles.filter(f => labratFiles.has(f));
}

// ─── State Persistence (D054/D045) ──────────────────────────────────────────

function syncStatePath(basePath: string): string {
  return join(basePath, SYNC_STATE_DIR, SYNC_STATE_FILE);
}

/**
 * Read sync state from `.gsd/UPSTREAM-SYNC.json`.
 * Returns default empty state on missing file.
 * Returns default empty state with stderr warning on malformed JSON.
 */
export function readSyncState(basePath: string): SyncState {
  const filePath = syncStatePath(basePath);

  if (!existsSync(filePath)) {
    return { ...DEFAULT_SYNC_STATE };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Shape validation
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'number'
    ) {
      console.error(`[upstream-sync] Malformed UPSTREAM-SYNC.json in ${basePath} — returning default state`);
      return { ...DEFAULT_SYNC_STATE };
    }

    return {
      lastFetchedUpstream: typeof parsed.lastFetchedUpstream === 'string' ? parsed.lastFetchedUpstream : '',
      evaluatedCommits: Array.isArray(parsed.evaluatedCommits) ? parsed.evaluatedCommits : [],
      appliedCommits: Array.isArray(parsed.appliedCommits) ? parsed.appliedCommits : [],
      version: parsed.version,
    };
  } catch (err) {
    console.error(
      `[upstream-sync] Corrupt UPSTREAM-SYNC.json in ${basePath} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...DEFAULT_SYNC_STATE };
  }
}

/**
 * Write sync state atomically using write-to-temp-then-rename (D045).
 * Crash during write leaves previous valid state intact.
 */
export function writeSyncState(basePath: string, state: SyncState): void {
  const filePath = syncStatePath(basePath);
  const tmpPath = filePath + '.tmp';

  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, filePath);
}

// ─── Filtering ──────────────────────────────────────────────────────────────

/**
 * Filter out commits that have already been evaluated.
 * Returns only commits whose hashes are not in `state.evaluatedCommits`.
 */
export function filterNewCommits(commits: UpstreamCommitInfo[], state: SyncState): UpstreamCommitInfo[] {
  const seen = new Set(state.evaluatedCommits);
  return commits.filter(c => !seen.has(c.hash));
}

// ─── Report Generation (Pure Function, D036) ────────────────────────────────

export interface SyncReportOptions {
  useColor?: boolean;
}

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

/**
 * Generate a formatted terminal report of upstream commits.
 *
 * Pure function — no I/O, just string assembly (D036 pattern).
 * Respects NO_COLOR via `options.useColor`.
 *
 * Sections:
 * 1. Infrastructure commits (safe to apply)
 * 2. Mixed commits (need review)
 * 3. Development-specific commits (skip)
 * 4. Summary counts
 */
export function generateSyncReport(
  commits: UpstreamCommitInfo[],
  options: SyncReportOptions = {},
): string {
  const useColor = options.useColor ?? !process.env.NO_COLOR;
  const c = makeColors(useColor);

  if (commits.length === 0) {
    return c.dim('No new upstream commits to evaluate.');
  }

  const infra = commits.filter(x => x.category === 'infrastructure');
  const mixed = commits.filter(x => x.category === 'mixed');
  const devSpecific = commits.filter(x => x.category === 'development-specific');

  const lines: string[] = [];

  lines.push(c.bold('═══ Upstream Sync Report ═══'));
  lines.push('');

  // Infrastructure section
  if (infra.length > 0) {
    lines.push(c.green(`▸ Infrastructure (${infra.length})`));
    for (const commit of infra) {
      const conflictNote = commit.conflictFiles.length > 0
        ? ` ${c.yellow('⚠ conflicts: ' + commit.conflictFiles.join(', '))}`
        : '';
      lines.push(`  ${c.dim(commit.hash.slice(0, 8))} ${commit.subject}${conflictNote}`);
    }
    lines.push('');
  }

  // Mixed section
  if (mixed.length > 0) {
    lines.push(c.yellow(`▸ Mixed — needs review (${mixed.length})`));
    for (const commit of mixed) {
      const conflictNote = commit.conflictFiles.length > 0
        ? ` ${c.yellow('⚠ conflicts: ' + commit.conflictFiles.join(', '))}`
        : '';
      lines.push(`  ${c.dim(commit.hash.slice(0, 8))} ${commit.subject}${conflictNote}`);
    }
    lines.push('');
  }

  // Development-specific section
  if (devSpecific.length > 0) {
    lines.push(c.cyan(`▸ Development-specific — skip (${devSpecific.length})`));
    for (const commit of devSpecific) {
      lines.push(`  ${c.dim(commit.hash.slice(0, 8))} ${commit.subject}`);
    }
    lines.push('');
  }

  // Summary
  lines.push(c.bold('Summary:'));
  lines.push(`  Infrastructure: ${infra.length}  Mixed: ${mixed.length}  Dev-specific: ${devSpecific.length}  Total: ${commits.length}`);

  return lines.join('\n');
}
