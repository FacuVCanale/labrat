/**
 * Contract tests for code-sync module.
 *
 * Uses synthetic git repos with bare remotes to prove:
 * - Successful push to bare remote
 * - Already-up-to-date detection
 * - Detached HEAD error handling
 * - Bad/missing remote error handling
 * - Diverged branch push failure
 * - Custom remote name support
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { pushExperimentBranch } from '../code-sync.ts';

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

/**
 * Create a bare remote and a cloned working repo with an initial commit pushed.
 * Returns { repo, bare } paths. The clone has "origin" pointing at the bare remote.
 */
function setupRepoWithBareRemote(remoteName = 'origin'): { repo: string; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), 'gsd-code-sync-bare-'));
  run('git init --bare', bare);

  const repo = mkdtempSync(join(tmpdir(), 'gsd-code-sync-work-'));
  run('git init -b main', repo);
  run('git config user.email test@example.com', repo);
  run('git config user.name Test', repo);
  writeFileSync(join(repo, 'README.md'), '# Test repo\n');
  run('git add .', repo);
  run("git commit -m 'initial commit'", repo);

  if (remoteName === 'origin') {
    run(`git remote add origin ${bare}`, repo);
  } else {
    run(`git remote add ${remoteName} ${bare}`, repo);
  }
  run(`git push ${remoteName} main`, repo);

  return { repo, bare };
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  // ═══ Push new commits ══════════════════════════════════════════════════════

  console.log('\n=== push new commits → pushed: true ===');

  {
    const { repo, bare } = setupRepoWithBareRemote();
    try {
      // Make a new commit
      writeFileSync(join(repo, 'new-file.ts'), 'export const x = 1;\n');
      run('git add .', repo);
      run("git commit -m 'add new file'", repo);

      const localHead = run('git rev-parse HEAD', repo);

      const result = pushExperimentBranch(repo);
      assert(result.pushed === true, 'push new: pushed is true');
      assertEq(result.ref, localHead, 'push new: ref matches local HEAD');
      assertEq(result.remote, 'origin', 'push new: remote is origin');
      assert(result.error === undefined, 'push new: no error');

      // Verify bare remote has the commit
      const bareHead = run('git rev-parse main', bare);
      assertEq(bareHead, localHead, 'push new: bare remote HEAD matches');
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ Already up-to-date ═══════════════════════════════════════════════════

  console.log('\n=== already up-to-date → pushed: false ===');

  {
    const { repo, bare } = setupRepoWithBareRemote();
    try {
      // No new commits — remote already has everything
      const localHead = run('git rev-parse HEAD', repo);

      const result = pushExperimentBranch(repo);
      assert(result.pushed === false, 'up-to-date: pushed is false');
      assertEq(result.ref, localHead, 'up-to-date: ref matches local HEAD');
      assert(result.error === undefined, 'up-to-date: no error');
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ Detached HEAD ════════════════════════════════════════════════════════

  console.log('\n=== detached HEAD → error ===');

  {
    const { repo, bare } = setupRepoWithBareRemote();
    try {
      // Detach HEAD
      const hash = run('git rev-parse HEAD', repo);
      run(`git checkout ${hash}`, repo);

      const result = pushExperimentBranch(repo);
      assert(result.pushed === false, 'detached: pushed is false');
      assert(result.error !== undefined, 'detached: error present');
      assert(result.error!.includes('Detached HEAD'), 'detached: error mentions detached HEAD');
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ Bad remote name ══════════════════════════════════════════════════════

  console.log('\n=== bad remote name → error ===');

  {
    const { repo, bare } = setupRepoWithBareRemote();
    try {
      // Make a new commit so it actually tries to push
      writeFileSync(join(repo, 'push-me.ts'), 'export const y = 1;\n');
      run('git add .', repo);
      run("git commit -m 'needs push'", repo);

      const result = pushExperimentBranch(repo, 'nonexistent-remote');
      assert(result.pushed === false, 'bad remote: pushed is false');
      assert(result.error !== undefined, 'bad remote: error present');
      assertEq(result.remote, 'nonexistent-remote', 'bad remote: remote name preserved');
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ Diverged branch (push rejected) ══════════════════════════════════════

  console.log('\n=== diverged branch → error ===');

  {
    const { repo, bare } = setupRepoWithBareRemote();
    try {
      // Create a second clone that pushes a conflicting commit
      const other = mkdtempSync(join(tmpdir(), 'gsd-code-sync-other-'));
      run(`git clone ${bare} .`, other);
      run('git checkout main', other);
      run('git config user.email other@example.com', other);
      run('git config user.name Other', other);
      writeFileSync(join(other, 'other.ts'), 'export const other = 1;\n');
      run('git add .', other);
      run("git commit -m 'other commit'", other);
      run('git push origin main', other);

      // Make a different commit in the original repo
      writeFileSync(join(repo, 'mine.ts'), 'export const mine = 1;\n');
      run('git add .', repo);
      run("git commit -m 'my commit'", repo);

      const result = pushExperimentBranch(repo);
      assert(result.pushed === false, 'diverged: pushed is false');
      assert(result.error !== undefined, 'diverged: error present');

      cleanup(other);
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ Custom remote name ═══════════════════════════════════════════════════

  console.log('\n=== custom remote name ===');

  {
    const { repo, bare } = setupRepoWithBareRemote('my-remote');
    try {
      // Make a new commit
      writeFileSync(join(repo, 'custom.ts'), 'export const custom = 1;\n');
      run('git add .', repo);
      run("git commit -m 'custom remote commit'", repo);

      const localHead = run('git rev-parse HEAD', repo);

      const result = pushExperimentBranch(repo, 'my-remote');
      assert(result.pushed === true, 'custom remote: pushed is true');
      assertEq(result.ref, localHead, 'custom remote: ref matches local HEAD');
      assertEq(result.remote, 'my-remote', 'custom remote: remote name correct');
      assert(result.error === undefined, 'custom remote: no error');

      // Verify bare remote has the commit
      const bareHead = run('git rev-parse main', bare);
      assertEq(bareHead, localHead, 'custom remote: bare remote HEAD matches');
    } finally {
      cleanup(repo, bare);
    }
  }

  // ═══ No remote configured at all ══════════════════════════════════════════

  console.log('\n=== no remote at all → error ===');

  {
    // Repo with no remotes
    const repo = mkdtempSync(join(tmpdir(), 'gsd-code-sync-noremote-'));
    try {
      run('git init -b main', repo);
      run('git config user.email test@example.com', repo);
      run('git config user.name Test', repo);
      writeFileSync(join(repo, 'README.md'), '# No remote\n');
      run('git add .', repo);
      run("git commit -m 'initial'", repo);

      const result = pushExperimentBranch(repo);
      assert(result.pushed === false, 'no remote: pushed is false');
      assert(result.error !== undefined, 'no remote: error present');
    } finally {
      cleanup(repo);
    }
  }

  // ═══ Summary ══════════════════════════════════════════════════════════════

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
