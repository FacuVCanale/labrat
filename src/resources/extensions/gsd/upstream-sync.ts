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

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

import { runGit } from './git-service.js';
import type { CommitCategory, UpstreamCommitInfo, SyncState, ApplyResult, VerifyResult, ConflictContext, AdaptedFile } from './types.js';

// Re-export types for consumer convenience
export type { CommitCategory, UpstreamCommitInfo, SyncState, ApplyResult, VerifyResult, ConflictContext, AdaptedFile };

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
 * Files known to be added by NightShift (not present in upstream GSD-2).
 * Commits touching ONLY these files are development-specific.
 */
const NIGHTSHIFT_ADDED_FILES = new Set([
  'agenda.ts',
  'steering.ts',
  'simplicity-scorer.ts',
  'eval-runner.ts',
  'mlops-integration.ts',
  'morning-report.ts',
]);

/** Prefix for NightShift-added prompt files */
const NIGHTSHIFT_PROMPTS_PREFIX = 'prompts/';

/** Prefix for infrastructure-only paths (upstream package structure) */
const INFRASTRUCTURE_PREFIXES = [
  'packages/',
];

/** Prefix for NightShift test files (development-specific) */
const NIGHTSHIFT_TEST_PREFIX = 'src/resources/extensions/gsd/tests/';

/**
 * Shared files that exist in both upstream and NightShift.
 * These require per-file analysis — a commit touching these is potentially
 * relevant to NightShift and triggers 'mixed' when combined with other categories.
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

  // NightShift test files → development-specific
  if (filePath.startsWith(NIGHTSHIFT_TEST_PREFIX)) {
    return 'development-specific';
  }

  // NightShift-added files → development-specific
  if (NIGHTSHIFT_ADDED_FILES.has(bare)) {
    return 'development-specific';
  }

  // NightShift prompts directory → development-specific
  if (bare.startsWith(NIGHTSHIFT_PROMPTS_PREFIX)) {
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

/** Cache for NightShift-modified files (computed once per basePath) */
const nightshiftFilesCache = new Map<string, Set<string>>();

/**
 * Get files that NightShift has modified since the fork point from upstream.
 * Cached per basePath for efficiency across multiple commit checks.
 */
export function getNightShiftModifiedFiles(basePath: string): Set<string> {
  const cached = nightshiftFilesCache.get(basePath);
  if (cached) return cached;

  // Find the fork point between HEAD and upstream/main
  const forkPoint = runGit(basePath, [
    'merge-base', 'HEAD', 'upstream/main',
  ], { allowFailure: true });

  if (!forkPoint) {
    // No common ancestor — can't determine modifications
    const empty = new Set<string>();
    nightshiftFilesCache.set(basePath, empty);
    return empty;
  }

  const diff = runGit(basePath, [
    'diff', '--name-only', `${forkPoint}..HEAD`,
  ], { allowFailure: true });

  const files = new Set(
    diff ? diff.split('\n').filter(Boolean) : [],
  );

  nightshiftFilesCache.set(basePath, files);
  return files;
}

/**
 * Clear the NightShift-modified files cache (useful in tests).
 */
export function clearNightShiftFilesCache(): void {
  nightshiftFilesCache.clear();
}

/**
 * Compare a commit's changed files against NightShift's modifications.
 * Returns the list of files that both the commit and NightShift have modified.
 */
export function getConflictFiles(basePath: string, commitFiles: string[]): string[] {
  const nightshiftFiles = getNightShiftModifiedFiles(basePath);
  return commitFiles.filter(f => nightshiftFiles.has(f));
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
  clearNightShiftFilesCache();
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

// ─── Verify After Apply ──────────────────────────────────────────────────────

/** Max output chars stored in VerifyResult to avoid huge payloads. */
const MAX_OUTPUT_LENGTH = 8000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  return output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)';
}

/**
 * Run build + test verification after a cherry-pick.
 *
 * - `npm run build` with 120s timeout, 10MB maxBuffer
 * - `npm test` with 300s timeout (only if build passes)
 * - Missing scripts treated as pass with skip note
 *
 * Returns structured VerifyResult — never throws.
 */
export function verifyAfterApply(basePath: string): VerifyResult {
  // Check if package.json exists with scripts
  let hasPackageJson = false;
  let hasBuildScript = false;
  let hasTestScript = false;
  try {
    const pkgPath = join(basePath, 'package.json');
    if (existsSync(pkgPath)) {
      hasPackageJson = true;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      hasBuildScript = !!(pkg.scripts && pkg.scripts.build);
      hasTestScript = !!(pkg.scripts && pkg.scripts.test);
    }
  } catch {
    // No package.json or unparseable — treat build/test as skip
  }

  let buildPassed = true;
  let testsPassed = true;
  let buildOutput: string | undefined;
  let testOutput: string | undefined;

  // Run build
  if (hasBuildScript) {
    try {
      const result = execSync('npm run build', {
        cwd: basePath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      buildOutput = truncateOutput(result);
    } catch (err: unknown) {
      buildPassed = false;
      const msg = err instanceof Error ? (err as any).stderr || (err as any).stdout || err.message : String(err);
      buildOutput = truncateOutput(String(msg));
      return { buildPassed, testsPassed: false, buildOutput, error: 'Build failed' };
    }
  } else {
    buildOutput = hasPackageJson ? 'No build script found — skipped' : 'No package.json — skipped';
  }

  // Run tests (only if build passed)
  if (hasTestScript) {
    try {
      const result = execSync('npm test', {
        cwd: basePath,
        encoding: 'utf-8',
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      testOutput = truncateOutput(result);
    } catch (err: unknown) {
      testsPassed = false;
      const msg = err instanceof Error ? (err as any).stderr || (err as any).stdout || err.message : String(err);
      testOutput = truncateOutput(String(msg));
      return { buildPassed, testsPassed, buildOutput, testOutput, error: 'Tests failed' };
    }
  } else {
    testOutput = hasPackageJson ? 'No test script found — skipped' : 'No package.json — skipped';
  }

  return { buildPassed, testsPassed, buildOutput, testOutput };
}

// ─── Get Conflict Context ────────────────────────────────────────────────────

/**
 * Extract structured conflict context from a cherry-pick conflict state.
 *
 * MUST be called BEFORE `git cherry-pick --abort` — the merge markers
 * exist in the working tree only while the conflict is active.
 *
 * For each unmerged file:
 * - `withMarkers`: raw file content with <<<<<<< / ======= / >>>>>>> markers
 * - `nightshiftVersion`: NightShift's pre-cherry-pick version (from HEAD before cherry-pick, i.e. MERGE_HEAD's parent)
 * - `upstreamPatch`: the upstream commit's diff for this file
 */
export function getConflictContext(basePath: string, hash: string): ConflictContext {
  // Get subject of the commit
  const subject = runGit(basePath, ['log', '-1', '--format=%s', hash], { allowFailure: true }) || '';

  // Get list of unmerged (conflicting) files
  const unmergedRaw = runGit(basePath, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true });
  const unmergedFiles = unmergedRaw ? unmergedRaw.split('\n').filter(Boolean) : [];

  const conflictingFiles = unmergedFiles.map(filePath => {
    // Read file with merge markers (current working tree state)
    let withMarkers = '';
    try {
      withMarkers = readFileSync(join(basePath, filePath), 'utf-8');
    } catch {
      withMarkers = '(unable to read file)';
    }

    // Get NightShift's version before the cherry-pick (HEAD's version)
    const nightshiftVersion = runGit(basePath, ['show', `HEAD:${filePath}`], { allowFailure: true }) || '';

    // Get the upstream patch for this file
    const upstreamPatch = runGit(basePath, ['diff', `${hash}~1`, hash, '--', filePath], { allowFailure: true }) || '';

    return { path: filePath, withMarkers, nightshiftVersion, upstreamPatch };
  });

  return { hash, subject, conflictingFiles };
}

// ─── Apply Upstream Commit ───────────────────────────────────────────────────

/**
 * Cherry-pick an upstream commit into the working repo.
 *
 * Flow:
 * 1. Validate hash not already applied
 * 2. Check clean working tree
 * 3. `git cherry-pick --no-commit <hash>`
 * 4. If clean: commit → verify → if verify fails, revert
 * 5. If conflict: extract context → abort → return conflict result
 *
 * Returns structured ApplyResult — never throws (D055).
 *
 * Diagnostic: `readSyncState(basePath).appliedCommits` shows applied hashes.
 */
export function applyUpstreamCommit(basePath: string, hash: string): ApplyResult {
  try {
    // Check if already applied
    const state = readSyncState(basePath);
    if (state.appliedCommits.includes(hash)) {
      return {
        success: false,
        conflicted: false,
        error: `Commit ${hash} has already been applied`,
      };
    }

    // Check clean working tree
    const status = runGit(basePath, ['status', '--porcelain'], { allowFailure: true });
    if (status && status.trim() !== '') {
      return {
        success: false,
        conflicted: false,
        error: 'Working tree is not clean — commit or stash changes first',
      };
    }

    // Get commit subject for the commit message
    const subject = runGit(basePath, ['log', '-1', '--format=%s', hash], { allowFailure: true }) || 'upstream change';
    const shortHash = hash.slice(0, 8);

    // Attempt cherry-pick --no-commit
    let cherryPickFailed = false;
    try {
      execSync(`git cherry-pick --no-commit ${hash}`, {
        cwd: basePath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      cherryPickFailed = true;
    }

    if (cherryPickFailed) {
      // Check if there are actual unmerged files (conflict) vs other error
      const unmerged = runGit(basePath, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true });

      if (unmerged && unmerged.trim() !== '') {
        // Conflict path: extract context BEFORE abort
        const conflictContext = getConflictContext(basePath, hash);

        // Abort the cherry-pick to leave repo clean
        try {
          execSync('git cherry-pick --abort', {
            cwd: basePath,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch {
          // If abort fails, try reset as fallback
          runGit(basePath, ['reset', '--hard', 'HEAD'], { allowFailure: true });
        }

        return {
          success: false,
          conflicted: true,
          conflictContext,
        };
      } else {
        // Non-conflict failure — abort and return error
        try {
          execSync('git cherry-pick --abort', {
            cwd: basePath,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch {
          runGit(basePath, ['reset', '--hard', 'HEAD'], { allowFailure: true });
        }

        return {
          success: false,
          conflicted: false,
          error: `Cherry-pick of ${hash} failed without conflicts`,
        };
      }
    }

    // Clean cherry-pick path: commit the staged changes
    try {
      runGit(basePath, ['commit', '-F', '-'], { input: `upstream(${shortHash}): ${subject}` });
    } catch (commitErr) {
      // If commit fails (e.g., empty commit), reset and return error
      runGit(basePath, ['reset', '--hard', 'HEAD'], { allowFailure: true });
      return {
        success: false,
        conflicted: false,
        error: `Failed to commit cherry-picked changes: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
      };
    }

    // Verify after apply
    const verifyResult = verifyAfterApply(basePath);

    if (!verifyResult.buildPassed || !verifyResult.testsPassed) {
      // Verify failed: revert the committed change
      try {
        runGit(basePath, ['revert', '--no-commit', 'HEAD']);
        runGit(basePath, ['commit', '-F', '-'], { input: `revert upstream(${shortHash}): verify failed` });
      } catch {
        // If revert fails, force reset to before the cherry-pick
        runGit(basePath, ['reset', '--hard', 'HEAD~1'], { allowFailure: true });
      }

      return {
        success: false,
        conflicted: false,
        verifyResult,
        error: 'Verification failed after cherry-pick — change has been reverted',
      };
    }

    // Success: update state
    state.appliedCommits.push(hash);
    writeSyncState(basePath, state);

    return {
      success: true,
      conflicted: false,
      verifyResult,
    };
  } catch (err) {
    // Catch-all: ensure we never throw
    // Try to abort any in-progress cherry-pick
    try {
      execSync('git cherry-pick --abort', {
        cwd: basePath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // Ignore — may not be in cherry-pick state
    }

    return {
      success: false,
      conflicted: false,
      error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── S03: LLM-Assisted Conflict Adaptation ──────────────────────────────────

/**
 * Build a complete adaptation prompt from conflict context.
 *
 * Pure function — no I/O, no side effects (D055).
 * Assembles sections:
 *   (a) upstream commit intent (hash, subject)
 *   (b) per-file conflict detail (merge markers, NightShift version, upstream patch)
 *   (c) optional NightShift project summary
 *   (d) output format specification
 */
export function buildAdaptationPrompt(context: ConflictContext, nightshiftSummary?: string): string {
  const sections: string[] = [];

  // (a) Upstream commit intent
  sections.push('## Upstream Commit');
  sections.push(`Hash: ${context.hash}`);
  sections.push(`Subject: ${context.subject}`);
  sections.push('');

  // (b) Per-file conflict details
  sections.push('## Conflicting Files');
  sections.push('');
  for (const file of context.conflictingFiles) {
    sections.push(`### ${file.path}`);
    sections.push('');
    sections.push('#### File with Merge Markers');
    sections.push('```');
    sections.push(file.withMarkers);
    sections.push('```');
    sections.push('');
    sections.push('#### NightShift\'s Version (pre-conflict)');
    sections.push('```');
    sections.push(file.nightshiftVersion);
    sections.push('```');
    sections.push('');
    sections.push('#### Upstream Patch');
    sections.push('```diff');
    sections.push(file.upstreamPatch);
    sections.push('```');
    sections.push('');
  }

  // (c) Optional NightShift project summary
  if (nightshiftSummary) {
    sections.push('## NightShift Project Summary');
    sections.push(nightshiftSummary);
    sections.push('');
  }

  // (d) Output format specification
  sections.push('## Output Format');
  sections.push('');
  sections.push('Produce the adapted version of each conflicting file. Preserve both NightShift\'s additions and the upstream fix intent.');
  sections.push('Output each file as a fenced code block with a `// FILE: <path>` header as the first line inside the block.');
  sections.push('');
  sections.push('Example:');
  sections.push('```');
  sections.push('// FILE: src/example.ts');
  sections.push('// ... adapted file content ...');
  sections.push('```');

  return sections.join('\n');
}

/**
 * Parse adapted file contents from LLM output.
 *
 * Scans for fenced code blocks (``` delimiters), looks for `// FILE: <path>`
 * as the first non-empty line inside each block.
 *
 * Handles deviations:
 * - Extra prose between blocks
 * - Varied fence styles (```ts, ```typescript, etc.)
 * - Missing trailing fence (treat as extending to end)
 * - `## FILE:` or `**FILE:**` header variants
 *
 * Returns empty array if no parseable blocks found.
 */
export function parseAdaptedFiles(llmOutput: string): AdaptedFile[] {
  const results: AdaptedFile[] = [];
  const lines = llmOutput.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Look for fence opening: ``` optionally followed by language tag
    if (/^```\w*\s*$/.test(line.trim())) {
      i++;

      // Collect lines until closing fence or end of input
      const blockLines: string[] = [];
      let foundClosingFence = false;
      while (i < lines.length) {
        const bLine = lines[i]!;
        if (/^```\s*$/.test(bLine.trim())) {
          foundClosingFence = true;
          i++;
          break;
        }
        blockLines.push(bLine);
        i++;
      }

      // Extract file path from first non-empty line
      const firstNonEmpty = blockLines.find(l => l.trim() !== '');
      if (firstNonEmpty) {
        const path = extractFilePath(firstNonEmpty);
        if (path) {
          // Content is everything after the header line
          const headerIdx = blockLines.indexOf(firstNonEmpty);
          const contentLines = blockLines.slice(headerIdx + 1);
          results.push({ path, content: contentLines.join('\n') });
        }
      }
    } else {
      i++;
    }
  }

  return results;
}

/**
 * Extract file path from a header line, supporting variants:
 * - `// FILE: <path>`
 * - `## FILE: <path>`
 * - `**FILE:** <path>`
 */
function extractFilePath(line: string): string | null {
  const trimmed = line.trim();

  // // FILE: path
  let match = trimmed.match(/^\/\/\s*FILE:\s*(.+)$/);
  if (match) return match[1]!.trim();

  // ## FILE: path
  match = trimmed.match(/^##\s*FILE:\s*(.+)$/);
  if (match) return match[1]!.trim();

  // **FILE:** path
  match = trimmed.match(/^\*\*FILE:\*\*\s*(.+)$/);
  if (match) return match[1]!.trim();

  return null;
}

/**
 * Apply adapted files to the working repo.
 *
 * Flow:
 * 1. Validate adaptedFiles non-empty
 * 2. Write each file to disk
 * 3. `git add` each file
 * 4. `git commit -F -` with `upstream-adapt(<short-hash>): <subject>`
 * 5. `verifyAfterApply()`
 * 6. If verify fails: revert commit and return error
 * 7. If verify passes: update sync state and return success
 *
 * Every exit path leaves the repo clean (no staged changes, no partial commits).
 * Uses existing `runGit()` for all git operations (D055).
 */
export function applyAdaptedFiles(
  basePath: string,
  hash: string,
  subject: string,
  adaptedFiles: AdaptedFile[],
): ApplyResult {
  if (adaptedFiles.length === 0) {
    return {
      success: false,
      conflicted: false,
      error: 'No adapted files provided',
    };
  }

  const shortHash = hash.slice(0, 8);

  try {
    // Write each adapted file to disk
    for (const file of adaptedFiles) {
      const filePath = join(basePath, file.path);
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, file.content, 'utf-8');
    }

    // Stage all adapted files
    for (const file of adaptedFiles) {
      runGit(basePath, ['add', file.path]);
    }

    // Commit with upstream-adapt message
    const commitMsg = `upstream-adapt(${shortHash}): ${subject}`;
    try {
      runGit(basePath, ['commit', '-F', '-'], { input: commitMsg });
    } catch (commitErr) {
      // Commit failed — reset staged changes to leave repo clean
      runGit(basePath, ['reset', '--hard', 'HEAD'], { allowFailure: true });
      return {
        success: false,
        conflicted: false,
        error: `Failed to commit adapted files: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
      };
    }

    // Verify after apply
    const verifyResult = verifyAfterApply(basePath);

    if (!verifyResult.buildPassed || !verifyResult.testsPassed) {
      // Verify failed: revert the committed change
      try {
        runGit(basePath, ['revert', '--no-commit', 'HEAD']);
        runGit(basePath, ['commit', '-F', '-'], { input: `revert upstream-adapt(${shortHash}): verify failed` });
      } catch {
        // If revert fails, force reset to before the adapt commit
        runGit(basePath, ['reset', '--hard', 'HEAD~1'], { allowFailure: true });
      }

      return {
        success: false,
        conflicted: false,
        verifyResult,
        error: 'Verification failed after adaptation — change has been reverted',
      };
    }

    // Success: update sync state
    const state = readSyncState(basePath);
    state.appliedCommits.push(hash);
    writeSyncState(basePath, state);

    return {
      success: true,
      conflicted: false,
      verifyResult,
    };
  } catch (err) {
    // Catch-all: ensure repo is clean
    runGit(basePath, ['reset', '--hard', 'HEAD'], { allowFailure: true });

    return {
      success: false,
      conflicted: false,
      error: `Unexpected error during adaptation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
