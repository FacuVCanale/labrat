/**
 * Contract tests for GSD Compute Backend.
 * Covers: LocalBackend success/failure/timeout, env merging,
 * resolveBackend factory, and RunEvalResult shape contract.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { LocalBackend, resolveBackend } from '../compute-backend.ts';
import type { ComputeBackend, ComputeEvalOpts } from '../compute-backend.ts';

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

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ─── LocalBackend.runEval() ─────────────────────────────────────────────────

console.log('LocalBackend.runEval()');

{
  console.log('  successful command returns stdout, exitCode 0, no signal, not timedOut');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = new LocalBackend();
    const result = backend.runEval({ command: 'echo hello', timeoutSecs: 10, cwd: tmpDir });
    assertEq(result.stdout, 'hello\n', 'stdout should be "hello\\n"');
    assertEq(result.stderr, '', 'stderr should be empty');
    assertEq(result.exitCode, 0, 'exitCode should be 0');
    assertEq(result.signal, null, 'signal should be null');
    assertEq(result.timedOut, false, 'timedOut should be false');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  failing command returns stderr, non-zero exitCode');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = new LocalBackend();
    const result = backend.runEval({ command: 'echo oops >&2 && exit 42', timeoutSecs: 10, cwd: tmpDir });
    assertEq(result.stdout, '', 'stdout should be empty');
    assertEq(result.stderr, 'oops\n', 'stderr should contain error message');
    assertEq(result.exitCode, 42, 'exitCode should be 42');
    assertEq(result.signal, null, 'signal should be null');
    assertEq(result.timedOut, false, 'timedOut should be false');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  timeout returns timedOut true, signal is SIGTERM');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = new LocalBackend();
    // sleep 60 with 1-second timeout — will be killed
    const result = backend.runEval({ command: 'sleep 60', timeoutSecs: 1, cwd: tmpDir });
    assertEq(result.timedOut, true, 'timedOut should be true');
    assertEq(result.signal, 'SIGTERM', 'signal should be SIGTERM');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  env merging: custom env var visible, process.env still accessible');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = new LocalBackend();
    const result = backend.runEval({
      command: 'echo $GSD_TEST_CUSTOM_VAR',
      timeoutSecs: 10,
      cwd: tmpDir,
      env: { GSD_TEST_CUSTOM_VAR: 'injected_value' },
    });
    assertEq(result.stdout, 'injected_value\n', 'custom env var should be visible');
    assertEq(result.exitCode, 0, 'should succeed');

    // process.env PATH should still be accessible (merged, not replaced)
    const result2 = backend.runEval({
      command: 'echo $PATH',
      timeoutSecs: 10,
      cwd: tmpDir,
      env: { GSD_TEST_CUSTOM_VAR: 'injected_value' },
    });
    assert(result2.stdout.length > 0, 'PATH should be non-empty (inherited from process.env)');
    assert(result2.stdout.includes('/'), 'PATH should contain slashes (real path, not empty)');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  no env: subprocess inherits process.env');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = new LocalBackend();
    const result = backend.runEval({
      command: 'echo $PATH',
      timeoutSecs: 10,
      cwd: tmpDir,
      // no env — should inherit process.env by default
    });
    assert(result.stdout.length > 0, 'PATH should be non-empty');
    assert(result.stdout.includes('/'), 'PATH should contain slashes (inherited from process.env)');
    assertEq(result.exitCode, 0, 'should succeed');
  } finally {
    cleanup(tmpDir);
  }
}

// ─── resolveBackend() ───────────────────────────────────────────────────────

console.log('resolveBackend()');

{
  console.log('  undefined config returns LocalBackend instance');
  const backend = resolveBackend(undefined);
  assert(backend instanceof LocalBackend, 'should be LocalBackend instance');
}

{
  console.log('  { type: "local" } returns LocalBackend instance');
  const backend = resolveBackend({ type: 'local' });
  assert(backend instanceof LocalBackend, 'should be LocalBackend instance');
}

{
  console.log('  unknown type throws with descriptive message');
  let threw = false;
  let errorMessage = '';
  try {
    resolveBackend({ type: 'bogus' } as any);
  } catch (e: any) {
    threw = true;
    errorMessage = e.message;
  }
  assert(threw, 'should throw for unknown type');
  assert(errorMessage.includes('bogus'), 'error message should include the unknown type name');
  assert(errorMessage.includes('Unsupported compute backend type'), 'error message should be descriptive');
}

// ─── Interface contract: RunEvalResult shape ────────────────────────────────

console.log('Interface contract');

{
  console.log('  result matches RunEvalResult shape');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend: ComputeBackend = new LocalBackend();
    const result = backend.runEval({ command: 'echo shape_test', timeoutSecs: 10, cwd: tmpDir });

    // Verify all expected keys are present with correct types
    assert(typeof result.stdout === 'string', 'stdout should be string');
    assert(typeof result.stderr === 'string', 'stderr should be string');
    assert(result.exitCode === null || typeof result.exitCode === 'number', 'exitCode should be number|null');
    assert(result.signal === null || typeof result.signal === 'string', 'signal should be string|null');
    assert(typeof result.timedOut === 'boolean', 'timedOut should be boolean');

    // Verify no unexpected keys
    const keys = Object.keys(result).sort();
    assertEq(keys, ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut'], 'should have exactly 5 RunEvalResult keys');
  } finally {
    cleanup(tmpDir);
  }
}

// ─── Integration: resolveBackend → backend.runEval() dispatch ────────────────

import { runEval } from '../eval-runner.ts';

console.log('Integration: dispatch parity');

{
  console.log('  resolveBackend(undefined) dispatch matches direct runEval()');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = resolveBackend(undefined);
    const backendResult = backend.runEval({ command: 'echo dispatch_test && echo ERR >&2', timeoutSecs: 10, cwd: tmpDir });
    const directResult = runEval('echo dispatch_test && echo ERR >&2', 10, tmpDir);

    assertEq(backendResult.stdout, directResult.stdout, 'stdout should match direct runEval');
    assertEq(backendResult.stderr, directResult.stderr, 'stderr should match direct runEval');
    assertEq(backendResult.exitCode, directResult.exitCode, 'exitCode should match direct runEval');
    assertEq(backendResult.signal, directResult.signal, 'signal should match direct runEval');
    assertEq(backendResult.timedOut, directResult.timedOut, 'timedOut should match direct runEval');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  resolveBackend({ type: "local" }) dispatch matches direct runEval()');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = resolveBackend({ type: 'local' });
    const backendResult = backend.runEval({ command: 'exit 7', timeoutSecs: 10, cwd: tmpDir });
    const directResult = runEval('exit 7', 10, tmpDir);

    assertEq(backendResult.exitCode, directResult.exitCode, 'exitCode should match for failure case');
    assertEq(backendResult.timedOut, directResult.timedOut, 'timedOut should match for failure case');
    assertEq(backendResult.signal, directResult.signal, 'signal should match for failure case');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  absent compute config defaults to LocalBackend transparently');
  const backend = resolveBackend(undefined);
  assert(backend instanceof LocalBackend, 'default should be LocalBackend');

  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    // Verify the backend actually runs subprocesses (not a stub)
    const result = backend.runEval({ command: 'echo real_subprocess', timeoutSecs: 10, cwd: tmpDir });
    assertEq(result.stdout, 'real_subprocess\n', 'should run a real subprocess');
    assertEq(result.exitCode, 0, 'should succeed');
  } finally {
    cleanup(tmpDir);
  }
}

{
  console.log('  dispatch failure path: structured error fields, no string parsing');
  const tmpDir = mkdtempSync(join(tmpdir(), 'gsd-cb-'));
  try {
    const backend = resolveBackend(undefined);
    const result = backend.runEval({ command: 'echo "structured error" >&2 && exit 99', timeoutSecs: 10, cwd: tmpDir });

    assertEq(result.exitCode, 99, 'exitCode should be 99');
    assertEq(result.stderr, 'structured error\n', 'stderr should contain error message');
    assertEq(result.timedOut, false, 'should not be timed out');
    assertEq(result.signal, null, 'signal should be null');
  } finally {
    cleanup(tmpDir);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
