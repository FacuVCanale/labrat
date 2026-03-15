/**
 * GSD Compute Backend — Abstraction for eval subprocess execution.
 *
 * Backends implement `ComputeBackend.runEval()` to run eval commands.
 * `LocalBackend` runs subprocesses locally via `spawnSync`.
 * `resolveBackend()` maps config to the appropriate backend instance.
 *
 * Future backends (SSH, Docker) will implement the same interface
 * without touching `runEval()` in eval-runner.ts.
 */

import { spawnSync } from 'node:child_process';

import type { RunEvalResult } from './eval-runner.js';
import type { ComputeConfig } from './types.js';
import { SSHBackend } from './ssh-backend.js';
import { DockerBackend } from './docker-backend.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Options passed to ComputeBackend.runEval(). */
export interface ComputeEvalOpts {
  command: string;
  timeoutSecs: number;
  cwd: string;
  env?: Record<string, string>;
}

// ─── Interface ──────────────────────────────────────────────────────────────

/** Abstract compute backend — all backends implement this synchronous interface. */
export interface ComputeBackend {
  runEval(opts: ComputeEvalOpts): RunEvalResult;
}

// ─── Local Backend ──────────────────────────────────────────────────────────

/**
 * Runs eval commands locally via spawnSync.
 * Produces identical output to the standalone runEval() in eval-runner.ts.
 */
export class LocalBackend implements ComputeBackend {
  runEval(opts: ComputeEvalOpts): RunEvalResult {
    const result = spawnSync(opts.command, {
      shell: true,
      timeout: opts.timeoutSecs * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      cwd: opts.cwd,
      encoding: 'utf-8',
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });

    const timedOut = result.signal === 'SIGTERM' || result.signal === 'SIGKILL';

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status,
      signal: result.signal,
      timedOut,
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Resolve a ComputeConfig to a backend instance.
 * Absent or `{ type: 'local' }` → LocalBackend.
 * Unknown types throw with a descriptive message.
 */
export function resolveBackend(config?: ComputeConfig): ComputeBackend {
  if (config === undefined || config.type === 'local') {
    return new LocalBackend();
  }

  if (config.type === 'ssh') {
    return new SSHBackend(config);
  }

  if (config.type === 'docker') {
    return new DockerBackend(config);
  }

  // Exhaustiveness guard — future types will add cases above
  const _exhaustive: never = config;
  throw new Error(`Unsupported compute backend type: "${(config as any).type}"`);
}

// ─── Pre-flight Checks ──────────────────────────────────────────────────────

/**
 * Check SSH connectivity to a remote host.
 * Runs `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true`.
 * Returns { ok: true } on exit 0, { ok: false, error: <stderr> } otherwise.
 */
export function checkSSHConnectivity(host: string): { ok: boolean; error?: string } {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, 'true'], {
    encoding: 'utf-8',
    timeout: 15_000,
  });
  if (result.status === 0) return { ok: true };
  return { ok: false, error: (result.stderr ?? '').trim() || `ssh exited with code ${result.status}` };
}

/**
 * Check Docker daemon reachability.
 * Runs `docker info` (or `docker -H <host> info` if dockerHost is set).
 * Returns { ok: true } on exit 0, { ok: false, error: <stderr> } otherwise.
 */
export function checkDockerDaemon(dockerHost?: string): { ok: boolean; error?: string } {
  const args = dockerHost ? ['-H', dockerHost, 'info'] : ['info'];
  const result = spawnSync('docker', args, {
    encoding: 'utf-8',
    timeout: 15_000,
  });
  if (result.status === 0) return { ok: true };
  return { ok: false, error: (result.stderr ?? '').trim() || `docker exited with code ${result.status}` };
}
