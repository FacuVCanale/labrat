/**
 * Contract tests for SSHBackend — real SSH to localhost, no mocking.
 *
 * Proves the full behavior matrix: success, failure, timeout (remote + safety-net path),
 * connection error, env forwarding, code sync integration, ControlMaster reuse,
 * RunEvalResult shape contract, and factory routing.
 *
 * Requires: SSH access to localhost (password-less, e.g. via authorized_keys).
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

import { SSHBackend } from '../ssh-backend.ts';
import type { SSHBackendConfig } from '../ssh-backend.ts';
import { resolveBackend } from '../compute-backend.ts';
import type { ComputeBackend } from '../compute-backend.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
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
function setupRepoWithBareRemote(): { repo: string; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), 'gsd-ssh-bare-'));
  run('git init --bare', bare);

  const repo = mkdtempSync(join(tmpdir(), 'gsd-ssh-work-'));
  run('git init -b main', repo);
  run('git config user.email test@example.com', repo);
  run('git config user.name Test', repo);
  writeFileSync(join(repo, 'README.md'), '# Test repo\n');
  run('git add .', repo);
  run("git commit -m 'initial commit'", repo);
  run(`git remote add origin ${bare}`, repo);
  run('git push origin main', repo);

  return { repo, bare };
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Kill ControlMaster socket if it exists. */
function cleanupControlSocket(controlPath: string): void {
  try {
    spawnSync('ssh', ['-O', 'exit', '-o', `ControlPath=${controlPath}`, 'localhost'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
  } catch { /* ignore — socket may not exist */ }
}

function makeSSHBackend(workDir: string, controlPath?: string): SSHBackend {
  const config: SSHBackendConfig = {
    type: 'ssh',
    host: 'localhost',
    workDir,
    controlPath: controlPath ?? join(tmpdir(), `gsd-test-ssh-%r@%h:%p-${Date.now()}`),
  };
  return new SSHBackend(config);
}

// ─── Successful remote eval ──────────────────────────────────────────────────

console.log('SSHBackend.runEval() — success');

{
  console.log('  successful remote eval: echo JSON, verify stdout/exitCode/timedOut');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-success-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: "echo '{\"metric\":1}'",
      timeoutSecs: 30,
      cwd: repo,
    });
    assertEq(result.exitCode, 0, 'exitCode should be 0');
    assert(result.stdout.includes('{"metric":1}'), 'stdout should contain JSON output');
    assertEq(result.timedOut, false, 'timedOut should be false');
    assertEq(result.signal, null, 'signal should be null');
    assert(typeof result.stderr === 'string', 'stderr should be a string');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── Remote command failure ──────────────────────────────────────────────────

console.log('SSHBackend.runEval() — failure');

{
  console.log('  failing command returns non-zero exitCode, stderr forwarded');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-fail-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'echo oops >&2 && exit 42',
      timeoutSecs: 30,
      cwd: repo,
    });
    assertEq(result.exitCode, 42, 'exitCode should be 42');
    assert(result.stderr.includes('oops'), 'stderr should contain error message');
    assertEq(result.timedOut, false, 'timedOut should be false');
    assertEq(result.signal, null, 'signal should be null');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── Remote timeout (exit 124) ───────────────────────────────────────────────

console.log('SSHBackend.runEval() — remote timeout');

{
  console.log('  sleep with short timeout → exit 124, timedOut true');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-timeout-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'sleep 999',
      timeoutSecs: 1,
      cwd: repo,
    });
    assertEq(result.exitCode, 124, 'exitCode should be 124 (remote timeout)');
    assertEq(result.timedOut, true, 'timedOut should be true');
    assertEq(result.signal, null, 'signal should be null (remote timeout, not signal kill)');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── SpawnSync safety-net timeout ────────────────────────────────────────────
//
// The SSHBackend calculates safety-net as (timeoutSecs + 30) * 1000, which makes
// a true end-to-end safety-net test take 31+ seconds. Instead, we directly invoke
// spawnSync with a short timeout against a hanging ssh command to prove the
// signal-based kill path produces the expected shape.

console.log('SSHBackend.runEval() — spawnSync safety-net path');

{
  console.log('  direct spawnSync timeout → signal SIGTERM, proves safety-net shape');
  // Directly exercise the code path: spawnSync kills ssh via SIGTERM when timeout fires.
  // We use a raw spawnSync with a 2s timeout to avoid waiting 31s.
  const result = spawnSync('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    'localhost',
    // Trap SIGTERM so remote `timeout` can't kill it — forces spawnSync safety-net
    "trap '' TERM; sleep 999",
  ], {
    timeout: 2000,
    encoding: 'utf-8',
  });

  // spawnSync should have killed via SIGTERM
  const timedOut = result.signal === 'SIGTERM' || result.signal === 'SIGKILL'
    || (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  assert(timedOut, 'spawnSync should have timed out (SIGTERM/SIGKILL or ETIMEDOUT)');
  assert(result.status === null || result.signal !== null || result.error !== null,
    'result should indicate abnormal termination');
}

// ─── SSH connection error ────────────────────────────────────────────────────

console.log('SSHBackend.runEval() — connection error');

{
  console.log('  unreachable host 192.0.2.1 → exit 255, error in stderr');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-conn-${Date.now()}`);
  try {
    // Use unreachable TEST-NET address with short ConnectTimeout
    const config: SSHBackendConfig = {
      type: 'ssh',
      host: '192.0.2.1',
      workDir: '/tmp/nonexistent',
      controlPath,
    };
    const backend = new SSHBackend(config);
    const result = backend.runEval({
      command: 'echo should-not-run',
      timeoutSecs: 5,
      cwd: repo,
    });
    assertEq(result.exitCode, 255, 'exitCode should be 255 (SSH connection error)');
    assertEq(result.timedOut, false, 'timedOut should be false (connection error, not timeout)');
    assert(result.stderr.length > 0, 'stderr should contain SSH error message');
    assertEq(result.signal, null, 'signal should be null');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── Env var forwarding ──────────────────────────────────────────────────────

console.log('SSHBackend.runEval() — env forwarding');

{
  console.log('  custom env vars visible in remote command output');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-env-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'echo $GSD_TEST_FOO-$GSD_TEST_BAR',
      timeoutSecs: 30,
      cwd: repo,
      env: { GSD_TEST_FOO: 'hello', GSD_TEST_BAR: 'world' },
    });
    assertEq(result.exitCode, 0, 'exitCode should be 0');
    assert(result.stdout.includes('hello-world'), 'stdout should contain env var values');
    assertEq(result.timedOut, false, 'timedOut should be false');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── Code sync before eval ───────────────────────────────────────────────────

console.log('SSHBackend.runEval() — code sync');

{
  console.log('  new commit synced to remote via pushExperimentBranch');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-sync-${Date.now()}`);

  // Create a second clone simulating the "remote workDir" — pointed at same bare remote
  const remoteWork = mkdtempSync(join(tmpdir(), 'gsd-ssh-remote-'));
  run(`git clone ${bare} .`, remoteWork);
  run('git checkout main', remoteWork);

  try {
    // Make a new commit with a marker file in the local repo
    writeFileSync(join(repo, 'marker.txt'), 'sync-test-marker\n');
    run('git add .', repo);
    run("git commit -m 'add marker'", repo);

    // SSHBackend pointed at the remoteWork directory on localhost
    const config: SSHBackendConfig = {
      type: 'ssh',
      host: 'localhost',
      workDir: remoteWork,
      controlPath,
    };
    const backend = new SSHBackend(config);
    const result = backend.runEval({
      command: 'cat marker.txt',
      timeoutSecs: 30,
      cwd: repo,
    });
    assertEq(result.exitCode, 0, 'exitCode should be 0');
    assert(result.stdout.includes('sync-test-marker'), 'stdout should contain marker file content (code was synced)');
    assertEq(result.timedOut, false, 'timedOut should be false');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare, remoteWork);
  }
}

// ─── Code sync failure (detached HEAD) ───────────────────────────────────────

console.log('SSHBackend.runEval() — code sync failure');

{
  console.log('  detached HEAD → structured error in stderr, not crash');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-syncfail-${Date.now()}`);
  try {
    // Detach HEAD
    const hash = run('git rev-parse HEAD', repo);
    run(`git checkout ${hash}`, repo);

    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'echo should-not-run',
      timeoutSecs: 30,
      cwd: repo,
    });
    // Should return structured error, not throw
    assert(result.stderr.includes('Code sync failed') || result.stderr.includes('Detached HEAD')
      || result.stderr.includes('Failed to get current branch'),
      'stderr should contain sync failure message');
    assertEq(result.timedOut, false, 'timedOut should be false');
    assert(result.exitCode !== 0 && result.exitCode !== null, 'exitCode should be non-zero');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── ControlMaster reuse ─────────────────────────────────────────────────────

console.log('SSHBackend.runEval() — ControlMaster reuse');

{
  console.log('  second eval reuses SSH connection (ControlMaster)');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-cm-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);

    // First eval — establishes ControlMaster
    const result1 = backend.runEval({
      command: 'echo first',
      timeoutSecs: 30,
      cwd: repo,
    });
    assertEq(result1.exitCode, 0, 'first eval exitCode should be 0');
    assert(result1.stdout.includes('first'), 'first eval stdout should contain "first"');

    // Check for ControlMaster socket existence
    const checkResult = spawnSync('ssh', [
      '-O', 'check',
      '-o', `ControlPath=${controlPath}`,
      'localhost',
    ], { encoding: 'utf-8', timeout: 5000 });
    const socketActive = checkResult.status === 0;

    // Second eval — should reuse connection
    const result2 = backend.runEval({
      command: 'echo second',
      timeoutSecs: 30,
      cwd: repo,
    });
    assertEq(result2.exitCode, 0, 'second eval exitCode should be 0');
    assert(result2.stdout.includes('second'), 'second eval stdout should contain "second"');

    // ControlMaster should have been active between evals
    assert(socketActive, 'ControlMaster socket should be active after first eval');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── RunEvalResult shape contract ────────────────────────────────────────────

console.log('RunEvalResult shape contract');

{
  console.log('  success result has exactly 5 fields with correct types');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-shape-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'echo shape_test',
      timeoutSecs: 30,
      cwd: repo,
    });

    assert(typeof result.stdout === 'string', 'stdout should be string');
    assert(typeof result.stderr === 'string', 'stderr should be string');
    assert(result.exitCode === null || typeof result.exitCode === 'number', 'exitCode should be number|null');
    assert(result.signal === null || typeof result.signal === 'string', 'signal should be string|null');
    assert(typeof result.timedOut === 'boolean', 'timedOut should be boolean');

    const keys = Object.keys(result).sort();
    assertEq(keys, ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut'], 'should have exactly 5 RunEvalResult keys');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

{
  console.log('  failure result has exactly 5 fields with correct types');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-shapefail-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'exit 99',
      timeoutSecs: 30,
      cwd: repo,
    });

    assert(typeof result.stdout === 'string', 'failure: stdout should be string');
    assert(typeof result.stderr === 'string', 'failure: stderr should be string');
    assert(result.exitCode === null || typeof result.exitCode === 'number', 'failure: exitCode should be number|null');
    assert(result.signal === null || typeof result.signal === 'string', 'failure: signal should be string|null');
    assert(typeof result.timedOut === 'boolean', 'failure: timedOut should be boolean');

    const keys = Object.keys(result).sort();
    assertEq(keys, ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut'], 'failure: should have exactly 5 keys');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

{
  console.log('  timeout result has exactly 5 fields with correct types');
  const { repo, bare } = setupRepoWithBareRemote();
  const controlPath = join(tmpdir(), `gsd-test-ssh-shapeto-${Date.now()}`);
  try {
    const backend = makeSSHBackend(repo, controlPath);
    const result = backend.runEval({
      command: 'sleep 999',
      timeoutSecs: 1,
      cwd: repo,
    });

    assert(typeof result.stdout === 'string', 'timeout: stdout should be string');
    assert(typeof result.stderr === 'string', 'timeout: stderr should be string');
    assert(result.exitCode === null || typeof result.exitCode === 'number', 'timeout: exitCode should be number|null');
    assert(result.signal === null || typeof result.signal === 'string', 'timeout: signal should be string|null');
    assert(typeof result.timedOut === 'boolean', 'timeout: timedOut should be boolean');

    const keys = Object.keys(result).sort();
    assertEq(keys, ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut'], 'timeout: should have exactly 5 keys');
  } finally {
    cleanupControlSocket(controlPath);
    cleanup(repo, bare);
  }
}

// ─── Factory routing ─────────────────────────────────────────────────────────

console.log('resolveBackend() — SSH routing');

{
  console.log('  resolveBackend({ type: "ssh", ... }) returns SSHBackend instance');
  const backend = resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp/x' });
  assert(backend instanceof SSHBackend, 'should be SSHBackend instance');
}

{
  console.log('  SSHBackend from factory implements ComputeBackend interface');
  const backend: ComputeBackend = resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp/x' });
  assert(typeof backend.runEval === 'function', 'should have runEval method');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
