/**
 * Contract tests for upstream-sync module.
 *
 * Uses synthetic git repos (mkdtempSync + git init) to prove:
 * - File-path classification accuracy
 * - State persistence (atomic writes, malformed degradation)
 * - Conflict detection
 * - Report generation (pure function)
 * - Idempotent evaluation filtering
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  categorizeCommit,
  parseGitLog,
  fetchUpstreamCommits,
  getConflictFiles,
  getNightShiftModifiedFiles,
  clearNightShiftFilesCache,
  readSyncState,
  writeSyncState,
  filterNewCommits,
  generateSyncReport,
  applyUpstreamCommit,
  verifyAfterApply,
  getConflictContext,
  buildAdaptationPrompt,
  parseAdaptedFiles,
  applyAdaptedFiles,
} from '../upstream-sync.ts';

import type { UpstreamCommitInfo, SyncState, ApplyResult, ConflictContext, AdaptedFile } from '../types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
}

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gsd-upstream-sync-'));
  run('git init -b main', repo);
  run('git config user.email test@example.com', repo);
  run('git config user.name Test', repo);
  writeFileSync(join(repo, 'README.md'), '# Test repo\n');
  run('git add .', repo);
  run("git commit -m 'initial commit'", repo);
  return repo;
}

/**
 * Create a synthetic upstream remote with commits for testing.
 * Returns { repo, upstream } paths.
 */
function setupRepoWithUpstream(): { repo: string; upstream: string } {
  // Create "upstream" bare-ish repo
  const upstream = mkdtempSync(join(tmpdir(), 'gsd-upstream-'));
  run('git init -b main', upstream);
  run('git config user.email upstream@example.com', upstream);
  run('git config user.name Upstream', upstream);
  writeFileSync(join(upstream, 'README.md'), '# Upstream\n');
  run('git add .', upstream);
  run("git commit -m 'upstream initial'", upstream);

  // Clone it as the working repo
  const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-work-'));
  run(`git clone ${upstream} .`, repo);
  run('git config user.email test@example.com', repo);
  run('git config user.name Test', repo);

  // Rename origin to upstream (to match expected remote name)
  run('git remote rename origin upstream', repo);

  return { repo, upstream };
}

function makeCommit(info: Partial<UpstreamCommitInfo>): UpstreamCommitInfo {
  return {
    hash: info.hash ?? 'abc1234567890',
    subject: info.subject ?? 'test commit',
    author: info.author ?? 'Test',
    date: info.date ?? '2025-01-01T00:00:00Z',
    filesChanged: info.filesChanged ?? [],
    category: info.category ?? 'infrastructure',
    conflictFiles: info.conflictFiles ?? [],
  };
}

async function main(): Promise<void> {
  // ═══ Classification Tests ═══════════════════════════════════════════════

  console.log('\n=== categorizeCommit: classification ===');

  // Infrastructure-only commit (packages/* files only) → infrastructure
  {
    const commit = makeCommit({ filesChanged: ['packages/core/index.ts', 'packages/cli/main.ts'] });
    const result = categorizeCommit(commit);
    assertEq(result, 'infrastructure', 'packages/* only → infrastructure');
  }

  // NightShift-added file only (steering.ts) → development-specific
  {
    const commit = makeCommit({ filesChanged: ['src/resources/extensions/gsd/steering.ts'] });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'steering.ts only → development-specific');
  }

  // Multiple NightShift-added files → development-specific
  {
    const commit = makeCommit({
      filesChanged: [
        'src/resources/extensions/gsd/eval-runner.ts',
        'src/resources/extensions/gsd/morning-report.ts',
      ],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'multiple NightShift-added files → development-specific');
  }

  // NightShift test files → development-specific
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/tests/eval-runner.test.ts'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'test file → development-specific');
  }

  // NightShift prompts directory → development-specific
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/prompts/experiment.md'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'prompts/* → development-specific');
  }

  // Mixed commit (shared file + packages) → infrastructure (shared treated as infra)
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/auto.ts', 'packages/core/foo.ts'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'infrastructure', 'shared + packages → infrastructure');
  }

  // Mixed commit (dev-specific + packages) → mixed
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/steering.ts', 'packages/core/foo.ts'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'mixed', 'dev-specific + packages → mixed');
  }

  // Mixed commit (dev-specific + shared) → mixed
  {
    const commit = makeCommit({
      filesChanged: [
        'src/resources/extensions/gsd/steering.ts',
        'src/resources/extensions/gsd/auto.ts',
      ],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'mixed', 'dev-specific + shared → mixed');
  }

  // Unknown files → infrastructure (conservative default)
  {
    const commit = makeCommit({ filesChanged: ['some-new-module.ts', 'lib/utils.ts'] });
    const result = categorizeCommit(commit);
    assertEq(result, 'infrastructure', 'unknown files → infrastructure (conservative)');
  }

  // Shared files only → infrastructure (conservative)
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/auto.ts', 'src/resources/extensions/gsd/types.ts'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'infrastructure', 'shared files only → infrastructure (conservative)');
  }

  // Empty files list → infrastructure
  {
    const commit = makeCommit({ filesChanged: [] });
    const result = categorizeCommit(commit);
    assertEq(result, 'infrastructure', 'empty files → infrastructure');
  }

  // ═══ Git Log Parsing ══════════════════════════════════════════════════════

  console.log('\n=== parseGitLog ===');

  {
    const raw = [
      'abc123‖fix: retry logic‖Alice‖2025-01-15T10:00:00Z',
      '',
      'packages/core/retry.ts',
      '',
      'def456‖feat: add agenda‖Bob‖2025-01-16T10:00:00Z',
      '',
      'src/resources/extensions/gsd/agenda.ts',
      'src/resources/extensions/gsd/steering.ts',
      '',
    ].join('\n');

    const commits = parseGitLog(raw);
    assertEq(commits.length, 2, 'parseGitLog parses 2 commits');
    assertEq(commits[0]!.hash, 'abc123', 'first commit hash');
    assertEq(commits[0]!.subject, 'fix: retry logic', 'first commit subject');
    assertEq(commits[0]!.author, 'Alice', 'first commit author');
    assertEq(commits[0]!.filesChanged, ['packages/core/retry.ts'], 'first commit files');
    assertEq(commits[0]!.category, 'infrastructure', 'first commit classified as infrastructure');
    assertEq(commits[1]!.category, 'development-specific', 'second commit classified as dev-specific');
  }

  // ═══ State Persistence ════════════════════════════════════════════════════

  console.log('\n=== state persistence ===');

  // Write → read round-trip preserves all fields
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-state-'));
    mkdirSync(join(repo, '.gsd'), { recursive: true });
    try {
      const state: SyncState = {
        lastFetchedUpstream: 'abc123def456',
        evaluatedCommits: ['commit1', 'commit2', 'commit3'],
        appliedCommits: ['commit1'],
        version: 1,
      };

      writeSyncState(repo, state);
      const read = readSyncState(repo);

      assertEq(read.lastFetchedUpstream, state.lastFetchedUpstream, 'round-trip: lastFetchedUpstream');
      assertEq(read.evaluatedCommits, state.evaluatedCommits, 'round-trip: evaluatedCommits');
      assertEq(read.appliedCommits, state.appliedCommits, 'round-trip: appliedCommits');
      assertEq(read.version, state.version, 'round-trip: version');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Missing file returns default empty state
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-missing-'));
    try {
      const state = readSyncState(repo);
      assertEq(state.lastFetchedUpstream, '', 'missing file: empty lastFetchedUpstream');
      assertEq(state.evaluatedCommits, [], 'missing file: empty evaluatedCommits');
      assertEq(state.appliedCommits, [], 'missing file: empty appliedCommits');
      assertEq(state.version, 1, 'missing file: version 1');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Malformed JSON degrades to fresh state with stderr warning
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-corrupt-'));
    mkdirSync(join(repo, '.gsd'), { recursive: true });
    try {
      writeFileSync(join(repo, '.gsd', 'UPSTREAM-SYNC.json'), '{bad json!!!');

      // Capture stderr
      const origErr = console.error;
      let stderrOutput = '';
      console.error = (...args: unknown[]) => { stderrOutput += args.join(' '); };

      const state = readSyncState(repo);

      console.error = origErr;

      assertEq(state.version, 1, 'malformed: returns default state');
      assertEq(state.evaluatedCommits, [], 'malformed: empty evaluatedCommits');
      assert(stderrOutput.includes('[upstream-sync]'), 'malformed: stderr warning emitted');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Invalid shape (missing version) degrades
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-shape-'));
    mkdirSync(join(repo, '.gsd'), { recursive: true });
    try {
      writeFileSync(join(repo, '.gsd', 'UPSTREAM-SYNC.json'), JSON.stringify({ foo: 'bar' }));

      const origErr = console.error;
      let stderrOutput = '';
      console.error = (...args: unknown[]) => { stderrOutput += args.join(' '); };

      const state = readSyncState(repo);

      console.error = origErr;

      assertEq(state.version, 1, 'invalid shape: returns default state');
      assert(stderrOutput.includes('Malformed'), 'invalid shape: stderr warning mentions malformed');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Atomic write: temp file doesn't persist on success
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-sync-atomic-'));
    mkdirSync(join(repo, '.gsd'), { recursive: true });
    try {
      writeSyncState(repo, { ...readSyncState(repo), lastFetchedUpstream: 'test' });

      const { existsSync } = await import('node:fs');
      assert(!existsSync(join(repo, '.gsd', 'UPSTREAM-SYNC.json.tmp')), 'atomic: no .tmp file after write');
      assert(existsSync(join(repo, '.gsd', 'UPSTREAM-SYNC.json')), 'atomic: .json file exists after write');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // ═══ Conflict Detection ═══════════════════════════════════════════════════

  console.log('\n=== conflict detection ===');

  // Commit touching file NightShift also modified → conflict reported
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Modify a file in NightShift (the working repo)
      writeFileSync(join(repo, 'README.md'), '# Modified by NightShift\n');
      run('git add .', repo);
      run("git commit -m 'nightshift change'", repo);

      clearNightShiftFilesCache();
      const conflicts = getConflictFiles(repo, ['README.md', 'other.ts']);
      assert(conflicts.includes('README.md'), 'conflict: README.md detected as conflicting');
      assert(!conflicts.includes('other.ts'), 'conflict: other.ts not in conflicts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // Commit touching file NightShift hasn't modified → no conflict
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      clearNightShiftFilesCache();
      const conflicts = getConflictFiles(repo, ['packages/core/new-file.ts']);
      assertEq(conflicts.length, 0, 'no conflict: untouched file has no conflicts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // getNightShiftModifiedFiles returns correct set
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      writeFileSync(join(repo, 'file-a.ts'), 'a\n');
      writeFileSync(join(repo, 'file-b.ts'), 'b\n');
      run('git add .', repo);
      run("git commit -m 'nightshift adds files'", repo);

      clearNightShiftFilesCache();
      const modified = getNightShiftModifiedFiles(repo);
      assert(modified.has('file-a.ts'), 'nightshift modified: file-a.ts present');
      assert(modified.has('file-b.ts'), 'nightshift modified: file-b.ts present');
      assert(!modified.has('README.md'), 'nightshift modified: README.md not present (unchanged)');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // ═══ Filtering (Idempotent Evaluation) ════════════════════════════════════

  console.log('\n=== filterNewCommits ===');

  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({ hash: 'aaa111' }),
      makeCommit({ hash: 'bbb222' }),
      makeCommit({ hash: 'ccc333' }),
    ];

    const state: SyncState = {
      lastFetchedUpstream: '',
      evaluatedCommits: ['aaa111', 'ccc333'],
      appliedCommits: [],
      version: 1,
    };

    const filtered = filterNewCommits(commits, state);
    assertEq(filtered.length, 1, 'filter: removes already-evaluated commits');
    assertEq(filtered[0]!.hash, 'bbb222', 'filter: only bbb222 remains');
  }

  // Filter with empty state returns all commits
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({ hash: 'aaa111' }),
      makeCommit({ hash: 'bbb222' }),
    ];

    const state: SyncState = {
      lastFetchedUpstream: '',
      evaluatedCommits: [],
      appliedCommits: [],
      version: 1,
    };

    const filtered = filterNewCommits(commits, state);
    assertEq(filtered.length, 2, 'filter empty state: all commits returned');
  }

  // Filter with all commits seen returns empty
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({ hash: 'aaa111' }),
    ];

    const state: SyncState = {
      lastFetchedUpstream: '',
      evaluatedCommits: ['aaa111'],
      appliedCommits: [],
      version: 1,
    };

    const filtered = filterNewCommits(commits, state);
    assertEq(filtered.length, 0, 'filter all seen: returns empty');
  }

  // ═══ Report Generation ════════════════════════════════════════════════════

  console.log('\n=== generateSyncReport ===');

  // Empty commit list → "no new upstream commits" message
  {
    const report = generateSyncReport([], { useColor: false });
    assert(report.includes('No new upstream commits'), 'empty: contains no-commits message');
  }

  // Infrastructure commits appear in infrastructure section
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({
        hash: 'abc12345',
        subject: 'fix: retry logic',
        category: 'infrastructure',
        filesChanged: ['packages/core/retry.ts'],
      }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(report.includes('Infrastructure (1)'), 'infra section header present');
    assert(report.includes('fix: retry logic'), 'infra commit subject in report');
    assert(report.includes('abc12345'), 'infra commit hash (truncated) in report');
  }

  // Mixed commits in mixed section
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({
        hash: 'def12345',
        subject: 'feat: update all',
        category: 'mixed',
      }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(report.includes('Mixed'), 'mixed section present');
    assert(report.includes('feat: update all'), 'mixed commit subject in report');
  }

  // Dev-specific commits in dev section
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({
        hash: 'ghi12345',
        subject: 'test: add eval tests',
        category: 'development-specific',
      }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(report.includes('Development-specific'), 'dev-specific section present');
    assert(report.includes('test: add eval tests'), 'dev-specific commit subject in report');
  }

  // Conflict files listed with warning markers
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({
        hash: 'jkl12345',
        subject: 'fix: shared update',
        category: 'infrastructure',
        conflictFiles: ['auto.ts', 'types.ts'],
      }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(report.includes('⚠'), 'conflict warning marker present');
    assert(report.includes('auto.ts'), 'conflict file auto.ts listed');
    assert(report.includes('types.ts'), 'conflict file types.ts listed');
  }

  // Summary counts are correct
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({ hash: 'a1', category: 'infrastructure' }),
      makeCommit({ hash: 'a2', category: 'infrastructure' }),
      makeCommit({ hash: 'b1', category: 'mixed' }),
      makeCommit({ hash: 'c1', category: 'development-specific' }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(report.includes('Infrastructure: 2'), 'summary: infra count = 2');
    assert(report.includes('Mixed: 1'), 'summary: mixed count = 1');
    assert(report.includes('Dev-specific: 1'), 'summary: dev count = 1');
    assert(report.includes('Total: 4'), 'summary: total count = 4');
  }

  // Color disabled report has no ANSI codes
  {
    const commits: UpstreamCommitInfo[] = [
      makeCommit({ hash: 'color1', category: 'infrastructure', subject: 'plain text' }),
    ];

    const report = generateSyncReport(commits, { useColor: false });
    assert(!report.includes('\x1b['), 'no-color: no ANSI escape codes');
  }

  // ═══ Fetch with Synthetic Upstream ════════════════════════════════════════

  console.log('\n=== fetchUpstreamCommits with synthetic repo ===');

  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Add commits to upstream
      mkdirSync(join(upstream, 'packages', 'core'), { recursive: true });
      writeFileSync(join(upstream, 'packages', 'core', 'retry.ts'), 'export const retry = true;\n');
      run('git add .', upstream);
      run("git commit -m 'fix: add retry logic'", upstream);

      writeFileSync(join(upstream, 'packages', 'core', 'cache.ts'), 'export const cache = true;\n');
      run('git add .', upstream);
      run("git commit -m 'feat: add cache layer'", upstream);

      // Fetch upstream in working repo
      run('git fetch upstream', repo);

      // Now fetch commits
      const commits = fetchUpstreamCommits(repo);
      assert(commits.length >= 2, 'fetch: at least 2 upstream commits found');

      // Find our specific commits
      const retryCommit = commits.find(c => c.subject === 'fix: add retry logic');
      assert(retryCommit !== undefined, 'fetch: retry commit found');
      if (retryCommit) {
        assert(retryCommit.filesChanged.some(f => f.includes('retry.ts')), 'fetch: retry commit has retry.ts');
        assertEq(retryCommit.category, 'infrastructure', 'fetch: retry commit → infrastructure');
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // ═══ S02: Apply, Verify, Conflict Context ═══════════════════════════════

  console.log('\n=== S02: applyUpstreamCommit — clean cherry-pick ===');

  // Clean cherry-pick: add a packages/ file in upstream, cherry-pick → success
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Add a file in upstream
      mkdirSync(join(upstream, 'packages', 'core'), { recursive: true });
      writeFileSync(join(upstream, 'packages', 'core', 'newutil.ts'), 'export const newutil = true;\n');
      run('git add .', upstream);
      run("git commit -m 'feat: add newutil'", upstream);
      const upstreamHash = run('git rev-parse HEAD', upstream);

      // Fetch in work repo
      run('git fetch upstream', repo);

      // Apply
      const result = applyUpstreamCommit(repo, upstreamHash);

      assert(result.success === true, 'clean apply: success is true');
      assert(result.conflicted === false, 'clean apply: conflicted is false');
      assert(result.error === undefined, 'clean apply: no error');

      // File should exist after apply
      const fileExists = existsSync(join(repo, 'packages', 'core', 'newutil.ts'));
      assert(fileExists, 'clean apply: newutil.ts exists in work repo');

      // appliedCommits should be updated
      const state = readSyncState(repo);
      assert(state.appliedCommits.includes(upstreamHash), 'clean apply: hash in appliedCommits');

      // Verify result should be present
      assert(result.verifyResult !== undefined, 'clean apply: verifyResult present');
      assert(result.verifyResult!.buildPassed === true, 'clean apply: buildPassed true (no package.json)');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: applyUpstreamCommit — conflict path ===');

  // Conflict path: modify same file in both repos → conflicted result with context
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Modify README.md in nightshift (work repo)
      writeFileSync(join(repo, 'README.md'), '# Modified by NightShift\nNightShift content here\n');
      run('git add .', repo);
      run("git commit -m 'nightshift: modify README'", repo);

      // Modify same file in upstream (conflicting change)
      writeFileSync(join(upstream, 'README.md'), '# Modified by Upstream\nUpstream content here\n');
      run('git add .', upstream);
      run("git commit -m 'upstream: modify README'", upstream);
      const upstreamHash = run('git rev-parse HEAD', upstream);

      // Fetch in work repo
      run('git fetch upstream', repo);

      // Apply — should conflict
      const result = applyUpstreamCommit(repo, upstreamHash);

      assert(result.success === false, 'conflict apply: success is false');
      assert(result.conflicted === true, 'conflict apply: conflicted is true');
      assert(result.conflictContext !== undefined, 'conflict apply: conflictContext present');

      if (result.conflictContext) {
        assert(result.conflictContext.hash === upstreamHash, 'conflict apply: context has correct hash');
        assert(result.conflictContext.conflictingFiles.length > 0, 'conflict apply: has conflicting files');

        const readmeConflict = result.conflictContext.conflictingFiles.find(f => f.path === 'README.md');
        assert(readmeConflict !== undefined, 'conflict apply: README.md in conflict files');
        if (readmeConflict) {
          assert(readmeConflict.withMarkers.includes('<<<<<<<'), 'conflict apply: withMarkers has <<<<<<< markers');
          assert(readmeConflict.withMarkers.includes('>>>>>>>'), 'conflict apply: withMarkers has >>>>>>> markers');
          assert(readmeConflict.nightshiftVersion.includes('NightShift'), 'conflict apply: nightshiftVersion has NightShift content');
          assert(readmeConflict.upstreamPatch.length > 0, 'conflict apply: upstreamPatch is non-empty');
        }
      }

      // Repo should be clean after abort
      const status = run('git status --porcelain', repo);
      assertEq(status, '', 'conflict apply: repo is clean after abort');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: applyUpstreamCommit — already-applied rejection ===');

  // Already-applied rejection: apply same hash twice → error without side effects
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Add a file in upstream
      mkdirSync(join(upstream, 'packages', 'core'), { recursive: true });
      writeFileSync(join(upstream, 'packages', 'core', 'feature.ts'), 'export const feature = 1;\n');
      run('git add .', upstream);
      run("git commit -m 'feat: add feature'", upstream);
      const upstreamHash = run('git rev-parse HEAD', upstream);

      // Fetch and apply first time
      run('git fetch upstream', repo);
      const firstResult = applyUpstreamCommit(repo, upstreamHash);
      assert(firstResult.success === true, 'already-applied: first apply succeeds');

      // Get commit count before second attempt
      const commitCountBefore = run('git rev-list --count HEAD', repo);

      // Apply same hash again
      const secondResult = applyUpstreamCommit(repo, upstreamHash);
      assert(secondResult.success === false, 'already-applied: second apply fails');
      assert(secondResult.conflicted === false, 'already-applied: not a conflict');
      assert(secondResult.error !== undefined, 'already-applied: error message present');
      assert(secondResult.error!.includes('already been applied'), 'already-applied: error says already applied');

      // No new commits should have been created
      const commitCountAfter = run('git rev-list --count HEAD', repo);
      assertEq(commitCountAfter, commitCountBefore, 'already-applied: no new commits');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: verifyAfterApply ===');

  // Verify returns appropriate result for repos without package.json
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-verify-'));
    run('git init -b main', repo);
    run('git config user.email test@example.com', repo);
    run('git config user.name Test', repo);
    writeFileSync(join(repo, 'file.txt'), 'hello\n');
    run('git add .', repo);
    run("git commit -m 'initial'", repo);
    try {
      const result = verifyAfterApply(repo);
      assert(result.buildPassed === true, 'verify no-pkg: buildPassed true');
      assert(result.testsPassed === true, 'verify no-pkg: testsPassed true');
      assert(result.buildOutput !== undefined, 'verify no-pkg: buildOutput present');
      assert(result.buildOutput!.includes('skipped'), 'verify no-pkg: buildOutput says skipped');
      assert(result.error === undefined, 'verify no-pkg: no error');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Verify with package.json but no scripts
  {
    const repo = mkdtempSync(join(tmpdir(), 'gsd-verify-noscripts-'));
    run('git init -b main', repo);
    run('git config user.email test@example.com', repo);
    run('git config user.name Test', repo);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
    run('git add .', repo);
    run("git commit -m 'initial'", repo);
    try {
      const result = verifyAfterApply(repo);
      assert(result.buildPassed === true, 'verify no-scripts: buildPassed true');
      assert(result.testsPassed === true, 'verify no-scripts: testsPassed true');
      assert(result.buildOutput!.includes('No build script'), 'verify no-scripts: build output mentions no script');
      assert(result.testOutput!.includes('No test script'), 'verify no-scripts: test output mentions no script');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: state persistence after apply ===');

  // State persistence: after successful apply, readSyncState shows hash in appliedCommits
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      mkdirSync(join(upstream, 'packages'), { recursive: true });
      writeFileSync(join(upstream, 'packages', 'state-test.ts'), 'export const x = 1;\n');
      run('git add .', upstream);
      run("git commit -m 'feat: state test'", upstream);
      const hash = run('git rev-parse HEAD', upstream);

      run('git fetch upstream', repo);
      applyUpstreamCommit(repo, hash);

      // Read state from disk directly
      const stateOnDisk = readSyncState(repo);
      assert(stateOnDisk.appliedCommits.includes(hash), 'state persistence: hash in appliedCommits on disk');
      assertEq(stateOnDisk.version, 1, 'state persistence: version is 1');

      // State file should actually exist
      assert(existsSync(join(repo, '.gsd', 'UPSTREAM-SYNC.json')), 'state persistence: UPSTREAM-SYNC.json exists');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: getConflictContext structure ===');

  // getConflictContext: verify structure has withMarkers, nightshiftVersion, upstreamPatch fields
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Create a conflict scenario
      writeFileSync(join(repo, 'README.md'), '# NightShift version\nLocal only content\n');
      run('git add .', repo);
      run("git commit -m 'nightshift: edit README'", repo);

      writeFileSync(join(upstream, 'README.md'), '# Upstream version\nRemote only content\n');
      run('git add .', upstream);
      run("git commit -m 'upstream: edit README'", upstream);
      const hash = run('git rev-parse HEAD', upstream);

      run('git fetch upstream', repo);

      // Manually trigger cherry-pick conflict to test getConflictContext directly
      let hadConflict = false;
      try {
        execSync(`git cherry-pick --no-commit ${hash}`, {
          cwd: repo,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        hadConflict = true;
      }

      assert(hadConflict, 'conflict context: cherry-pick produced conflict');

      if (hadConflict) {
        const ctx = getConflictContext(repo, hash);

        assertEq(ctx.hash, hash, 'conflict context: hash matches');
        assert(ctx.subject.includes('upstream'), 'conflict context: subject from upstream commit');
        assert(ctx.conflictingFiles.length > 0, 'conflict context: has conflicting files');

        const readme = ctx.conflictingFiles.find(f => f.path === 'README.md');
        assert(readme !== undefined, 'conflict context: README.md found');
        if (readme) {
          assert(typeof readme.withMarkers === 'string', 'conflict context: withMarkers is string');
          assert(readme.withMarkers.includes('<<<<<<<'), 'conflict context: withMarkers has conflict markers');
          assert(typeof readme.nightshiftVersion === 'string', 'conflict context: nightshiftVersion is string');
          assert(readme.nightshiftVersion.includes('NightShift'), 'conflict context: nightshiftVersion has NightShift content');
          assert(typeof readme.upstreamPatch === 'string', 'conflict context: upstreamPatch is string');
          assert(readme.upstreamPatch.length > 0, 'conflict context: upstreamPatch non-empty');
        }

        // Clean up the cherry-pick state
        try {
          execSync('git cherry-pick --abort', { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch {
          execSync('git reset --hard HEAD', { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        }
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  console.log('\n=== S02: dirty working tree guard ===');

  // Dirty tree guard: apply with uncommitted changes → error
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      mkdirSync(join(upstream, 'packages'), { recursive: true });
      writeFileSync(join(upstream, 'packages', 'dirty-test.ts'), 'export const d = 1;\n');
      run('git add .', upstream);
      run("git commit -m 'feat: dirty test'", upstream);
      const hash = run('git rev-parse HEAD', upstream);

      run('git fetch upstream', repo);

      // Create dirty state in work repo
      writeFileSync(join(repo, 'dirty-file.txt'), 'uncommitted\n');

      const result = applyUpstreamCommit(repo, hash);
      assert(result.success === false, 'dirty tree: success is false');
      assert(result.error !== undefined, 'dirty tree: error present');
      assert(result.error!.includes('not clean'), 'dirty tree: error mentions not clean');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // ═══ S03: Adaptation Core — Prompt Builder, Parser, File Applicator ═══════

  console.log('\n=== S03: buildAdaptationPrompt ===');

  // Prompt contains upstream hash and subject
  {
    const ctx: ConflictContext = {
      hash: 'abc123def456',
      subject: 'fix: update retry logic',
      conflictingFiles: [{
        path: 'src/retry.ts',
        withMarkers: '<<<<<<< HEAD\nold\n=======\nnew\n>>>>>>> abc123',
        nightshiftVersion: 'const retry = true;',
        upstreamPatch: '--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -1 +1 @@\n-old\n+new',
      }],
    };
    const prompt = buildAdaptationPrompt(ctx);
    assert(prompt.includes('abc123def456'), 'prompt: contains full hash');
    assert(prompt.includes('fix: update retry logic'), 'prompt: contains subject');
    assert(prompt.includes('src/retry.ts'), 'prompt: contains file path');
    assert(prompt.includes('<<<<<<<'), 'prompt: contains merge markers');
    assert(prompt.includes('const retry = true'), 'prompt: contains NightShift version');
    assert(prompt.includes('--- a/src/retry.ts'), 'prompt: contains upstream patch');
    assert(prompt.includes('// FILE:'), 'prompt: contains format instructions');
    assert(prompt.includes('Output Format'), 'prompt: has output format section');
  }

  // Prompt handles multiple conflicting files
  {
    const ctx: ConflictContext = {
      hash: 'multi123',
      subject: 'feat: multi-file change',
      conflictingFiles: [
        { path: 'file-a.ts', withMarkers: 'markers-a', nightshiftVersion: 'nightshift-a', upstreamPatch: 'patch-a' },
        { path: 'file-b.ts', withMarkers: 'markers-b', nightshiftVersion: 'nightshift-b', upstreamPatch: 'patch-b' },
      ],
    };
    const prompt = buildAdaptationPrompt(ctx);
    assert(prompt.includes('file-a.ts'), 'prompt multi: contains file-a path');
    assert(prompt.includes('file-b.ts'), 'prompt multi: contains file-b path');
    assert(prompt.includes('markers-a'), 'prompt multi: contains file-a markers');
    assert(prompt.includes('markers-b'), 'prompt multi: contains file-b markers');
  }

  // Prompt includes optional summary when provided
  {
    const ctx: ConflictContext = {
      hash: 'sum123',
      subject: 'test',
      conflictingFiles: [{ path: 'f.ts', withMarkers: 'm', nightshiftVersion: 'l', upstreamPatch: 'p' }],
    };
    const prompt = buildAdaptationPrompt(ctx, 'NightShift is a research tool that runs experiments.');
    assert(prompt.includes('NightShift Project Summary'), 'prompt summary: has summary section');
    assert(prompt.includes('NightShift is a research tool'), 'prompt summary: contains summary text');
  }

  // Prompt omits summary section when not provided
  {
    const ctx: ConflictContext = {
      hash: 'nosum123',
      subject: 'test',
      conflictingFiles: [{ path: 'f.ts', withMarkers: 'm', nightshiftVersion: 'l', upstreamPatch: 'p' }],
    };
    const prompt = buildAdaptationPrompt(ctx);
    assert(!prompt.includes('NightShift Project Summary'), 'prompt no-summary: summary section absent');
  }

  console.log('\n=== S03: parseAdaptedFiles ===');

  // Parse single file block
  {
    const output = [
      'Here is the adapted file:',
      '```',
      '// FILE: src/retry.ts',
      'export const retry = true;',
      'export const timeout = 5000;',
      '```',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 1, 'parse single: returns 1 file');
    assertEq(files[0]!.path, 'src/retry.ts', 'parse single: correct path');
    assert(files[0]!.content.includes('export const retry = true;'), 'parse single: content has retry');
    assert(files[0]!.content.includes('export const timeout = 5000;'), 'parse single: content has timeout');
  }

  // Parse multiple files with prose between
  {
    const output = [
      'I adapted both files:',
      '',
      '```typescript',
      '// FILE: src/a.ts',
      'const a = 1;',
      '```',
      '',
      'And here is the second file:',
      '',
      '```ts',
      '// FILE: src/b.ts',
      'const b = 2;',
      '```',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 2, 'parse multi: returns 2 files');
    assertEq(files[0]!.path, 'src/a.ts', 'parse multi: first path');
    assertEq(files[1]!.path, 'src/b.ts', 'parse multi: second path');
    assert(files[0]!.content.includes('const a = 1'), 'parse multi: first content');
    assert(files[1]!.content.includes('const b = 2'), 'parse multi: second content');
  }

  // Parse handles missing trailing fence
  {
    const output = [
      '```',
      '// FILE: src/unterminated.ts',
      'const x = 1;',
      'const y = 2;',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 1, 'parse no-fence: returns 1 file');
    assertEq(files[0]!.path, 'src/unterminated.ts', 'parse no-fence: correct path');
    assert(files[0]!.content.includes('const x = 1'), 'parse no-fence: has content');
  }

  // Block without FILE header is skipped
  {
    const output = [
      '```',
      'just some code without a FILE header',
      'more code',
      '```',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 0, 'parse no-header: skips block without FILE header');
  }

  // ## FILE: header variant
  {
    const output = [
      '```',
      '## FILE: src/alt-header.ts',
      'const alt = true;',
      '```',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 1, 'parse ## header: returns 1 file');
    assertEq(files[0]!.path, 'src/alt-header.ts', 'parse ## header: correct path');
  }

  // **FILE:** header variant
  {
    const output = [
      '```',
      '**FILE:** src/bold-header.ts',
      'const bold = true;',
      '```',
    ].join('\n');
    const files = parseAdaptedFiles(output);
    assertEq(files.length, 1, 'parse ** header: returns 1 file');
    assertEq(files[0]!.path, 'src/bold-header.ts', 'parse ** header: correct path');
  }

  // Completely unparseable input returns empty
  {
    const files1 = parseAdaptedFiles('Just some text with no code blocks at all.');
    assertEq(files1.length, 0, 'parse unparseable: plain text returns empty');

    const files2 = parseAdaptedFiles('');
    assertEq(files2.length, 0, 'parse unparseable: empty string returns empty');
  }

  console.log('\n=== S03: applyAdaptedFiles ===');

  // Successful application: writes files, commits, verifies, updates state
  {
    const repo = setupRepo();
    try {
      const adaptedFiles: AdaptedFile[] = [
        { path: 'src/adapted.ts', content: 'export const adapted = true;\n' },
      ];
      const result = applyAdaptedFiles(repo, 'abc123def456789', 'fix: retry logic', adaptedFiles);

      assert(result.success === true, 'adapt apply: success is true');
      assert(result.conflicted === false, 'adapt apply: conflicted is false');
      assert(result.error === undefined, 'adapt apply: no error');
      assert(result.verifyResult !== undefined, 'adapt apply: verifyResult present');

      // File should exist
      const fileContent = readFileSync(join(repo, 'src', 'adapted.ts'), 'utf-8');
      assert(fileContent.includes('export const adapted = true'), 'adapt apply: file written correctly');

      // Commit message pattern
      const lastCommit = run('git log -1 --format=%s', repo);
      assert(lastCommit.includes('upstream-adapt('), 'adapt apply: commit message has upstream-adapt prefix');
      assert(lastCommit.includes('abc123de'), 'adapt apply: commit message has short hash');
      assert(lastCommit.includes('fix: retry logic'), 'adapt apply: commit message has subject');

      // State updated
      const state = readSyncState(repo);
      assert(state.appliedCommits.includes('abc123def456789'), 'adapt apply: hash in appliedCommits');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Empty adaptedFiles → error
  {
    const repo = setupRepo();
    try {
      const result = applyAdaptedFiles(repo, 'empty123', 'test', []);
      assert(result.success === false, 'adapt empty: success is false');
      assert(result.error !== undefined, 'adapt empty: error present');
      assert(result.error!.includes('No adapted files'), 'adapt empty: error mentions empty');

      // Repo should be clean
      const status = run('git status --porcelain', repo);
      assertEq(status, '', 'adapt empty: repo is clean');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Multiple files applied and committed together
  {
    const repo = setupRepo();
    try {
      const adaptedFiles: AdaptedFile[] = [
        { path: 'multi-a.ts', content: 'const a = 1;\n' },
        { path: 'multi-b.ts', content: 'const b = 2;\n' },
      ];
      const result = applyAdaptedFiles(repo, 'multi123456789', 'feat: multi-file', adaptedFiles);

      assert(result.success === true, 'adapt multi: success');
      assert(existsSync(join(repo, 'multi-a.ts')), 'adapt multi: file-a exists');
      assert(existsSync(join(repo, 'multi-b.ts')), 'adapt multi: file-b exists');

      // Both files in one commit
      const filesInCommit = run('git diff-tree --no-commit-id --name-only -r HEAD', repo);
      assert(filesInCommit.includes('multi-a.ts'), 'adapt multi: file-a in commit');
      assert(filesInCommit.includes('multi-b.ts'), 'adapt multi: file-b in commit');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Repo stays clean after every exit path (tested via empty input above and success above)
  // Additional: verify no staged or modified files after successful adapt (untracked .gsd/ is expected — sync state file)
  {
    const repo = setupRepo();
    try {
      const adaptedFiles: AdaptedFile[] = [
        { path: 'clean-check.ts', content: 'export const clean = true;\n' },
      ];
      applyAdaptedFiles(repo, 'clean123456789', 'test: clean check', adaptedFiles);
      // Check for staged/modified (exclude untracked .gsd/ which is the sync state dir)
      const staged = run('git diff --cached --name-only', repo);
      assertEq(staged, '', 'adapt clean: no staged changes after success');
      const modified = run('git diff --name-only', repo);
      assertEq(modified, '', 'adapt clean: no modified files after success');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // ═══ Summary ══════════════════════════════════════════════════════════════

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
