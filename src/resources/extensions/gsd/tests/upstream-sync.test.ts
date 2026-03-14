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

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  categorizeCommit,
  parseGitLog,
  fetchUpstreamCommits,
  getConflictFiles,
  getLabratModifiedFiles,
  clearLabratFilesCache,
  readSyncState,
  writeSyncState,
  filterNewCommits,
  generateSyncReport,
} from '../upstream-sync.ts';

import type { UpstreamCommitInfo, SyncState } from '../types.ts';

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

  // Labrat-added file only (steering.ts) → development-specific
  {
    const commit = makeCommit({ filesChanged: ['src/resources/extensions/gsd/steering.ts'] });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'steering.ts only → development-specific');
  }

  // Multiple Labrat-added files → development-specific
  {
    const commit = makeCommit({
      filesChanged: [
        'src/resources/extensions/gsd/eval-runner.ts',
        'src/resources/extensions/gsd/morning-report.ts',
      ],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'multiple Labrat-added files → development-specific');
  }

  // Labrat test files → development-specific
  {
    const commit = makeCommit({
      filesChanged: ['src/resources/extensions/gsd/tests/eval-runner.test.ts'],
    });
    const result = categorizeCommit(commit);
    assertEq(result, 'development-specific', 'test file → development-specific');
  }

  // Labrat prompts directory → development-specific
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

  // Commit touching file Labrat also modified → conflict reported
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      // Modify a file in Labrat (the working repo)
      writeFileSync(join(repo, 'README.md'), '# Modified by Labrat\n');
      run('git add .', repo);
      run("git commit -m 'labrat change'", repo);

      clearLabratFilesCache();
      const conflicts = getConflictFiles(repo, ['README.md', 'other.ts']);
      assert(conflicts.includes('README.md'), 'conflict: README.md detected as conflicting');
      assert(!conflicts.includes('other.ts'), 'conflict: other.ts not in conflicts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // Commit touching file Labrat hasn't modified → no conflict
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      clearLabratFilesCache();
      const conflicts = getConflictFiles(repo, ['packages/core/new-file.ts']);
      assertEq(conflicts.length, 0, 'no conflict: untouched file has no conflicts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(upstream, { recursive: true, force: true });
    }
  }

  // getLabratModifiedFiles returns correct set
  {
    const { repo, upstream } = setupRepoWithUpstream();
    try {
      writeFileSync(join(repo, 'file-a.ts'), 'a\n');
      writeFileSync(join(repo, 'file-b.ts'), 'b\n');
      run('git add .', repo);
      run("git commit -m 'labrat adds files'", repo);

      clearLabratFilesCache();
      const modified = getLabratModifiedFiles(repo);
      assert(modified.has('file-a.ts'), 'labrat modified: file-a.ts present');
      assert(modified.has('file-b.ts'), 'labrat modified: file-b.ts present');
      assert(!modified.has('README.md'), 'labrat modified: README.md not present (unchanged)');
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

  // ═══ Summary ══════════════════════════════════════════════════════════════

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
