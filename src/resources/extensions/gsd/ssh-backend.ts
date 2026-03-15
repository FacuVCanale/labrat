/**
 * GSD SSH Compute Backend — Runs eval commands on a remote host via native ssh.
 *
 * Flow: push experiment branch → build env prefix → build remote command
 *       (cd workDir, git fetch+reset, timeout eval) → spawnSync('ssh', ...)
 *       → map exit codes to RunEvalResult.
 *
 * Exit code mapping:
 *   124        → timedOut:true (remote `timeout` command killed the eval)
 *   255        → SSH connection error (stderr preserved)
 *   ETIMEDOUT  → timedOut:true (spawnSync safety-net killed the connection)
 *   other      → forwarded as-is
 *
 * Connection reuse via ControlMaster/ControlPersist/ControlPath.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import type { ComputeConfig, SyncResult } from './types.js';
import type { RunEvalResult } from './eval-runner.js';
import type { ComputeBackend, ComputeEvalOpts } from './compute-backend.js';
import { pushExperimentBranch } from './code-sync.js';
import { runGit } from './git-service.js';

// ─── Config type guard ──────────────────────────────────────────────────────

export type SSHBackendConfig = Extract<ComputeConfig, { type: 'ssh' }>;

// ─── SSH Backend ────────────────────────────────────────────────────────────

/**
 * Runs eval commands on a remote host via native `ssh` binary.
 *
 * Before each eval:
 * 1. Pushes the experiment branch to origin via pushExperimentBranch()
 * 2. Builds a remote command that fetches + resets to the pushed ref
 * 3. Runs the eval command wrapped in `timeout` for remote enforcement
 * 4. Uses a spawnSync safety-net timeout (+30s) as a fallback
 *
 * SSH connection reuse is enabled via ControlMaster/ControlPersist options.
 */
export class SSHBackend implements ComputeBackend {
  private readonly host: string;
  private readonly workDir: string;
  private readonly controlPath: string;

  constructor(config: SSHBackendConfig) {
    this.host = config.host;
    this.workDir = config.workDir;
    this.controlPath = config.controlPath ?? join('/tmp', `gsd-ssh-%r@%h:%p`);
  }

  runEval(opts: ComputeEvalOpts): RunEvalResult {
    // 1. Push experiment branch — failure returns structured error, no throw
    const syncResult: SyncResult = pushExperimentBranch(opts.cwd);
    if (syncResult.error && !syncResult.pushed) {
      return {
        stdout: '',
        stderr: `Code sync failed: ${syncResult.error}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      };
    }

    // 2. Get current branch for remote git fetch+reset
    let branch: string;
    try {
      branch = runGit(opts.cwd, ['branch', '--show-current']);
    } catch (err) {
      return {
        stdout: '',
        stderr: `Failed to get current branch: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      };
    }

    // 3. Build env prefix: export KEY='VALUE'; for each env var
    let envPrefix = '';
    if (opts.env && Object.keys(opts.env).length > 0) {
      envPrefix = Object.entries(opts.env)
        .map(([key, value]) => `export ${key}=${shellQuote(value)};`)
        .join(' ') + ' ';
    }

    // 4. Build remote command:
    //    cd workDir && git fetch origin && git reset --hard origin/<branch> && timeout <secs> <command>
    const remoteCommand = [
      `cd ${shellQuote(this.workDir)}`,
      `git fetch origin`,
      `git reset --hard origin/${branch}`,
      `${envPrefix}timeout ${opts.timeoutSecs} ${opts.command}`,
    ].join(' && ');

    // 5. Build SSH args with connection reuse options
    const sshArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlPersist=60',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      this.host,
      remoteCommand,
    ];

    // 6. Execute via spawnSync with safety-net timeout (+30s buffer)
    const safetyNetMs = (opts.timeoutSecs + 30) * 1000;
    const result = spawnSync('ssh', sshArgs, {
      timeout: safetyNetMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'utf-8',
    });

    // 7. Map result to RunEvalResult
    return mapSSHResult(result);
  }
}

// ─── Result Mapping ─────────────────────────────────────────────────────────

/**
 * Map spawnSync result to RunEvalResult with SSH-specific exit code handling.
 *
 * - spawnSync error with code ETIMEDOUT → safety-net timeout fired
 * - exit 124 → remote `timeout` command killed the eval
 * - exit 255 without spawnSync ETIMEDOUT → SSH connection error
 * - signal SIGTERM/SIGKILL → spawnSync killed the process (safety-net)
 * - otherwise → forward exit code as-is
 */
function mapSSHResult(result: ReturnType<typeof spawnSync>): RunEvalResult {
  const stdout = (result.stdout as string) ?? '';
  const stderr = (result.stderr as string) ?? '';

  // Safety-net timeout: spawnSync killed the ssh process
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return {
      stdout,
      stderr: stderr || 'SSH command timed out (safety-net timeout)',
      exitCode: null,
      signal: null,
      timedOut: true,
    };
  }

  // spawnSync signal-based kill (safety-net)
  if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
    return {
      stdout,
      stderr,
      exitCode: null,
      signal: result.signal,
      timedOut: true,
    };
  }

  // Remote timeout command exit 124
  if (result.status === 124) {
    return {
      stdout,
      stderr,
      exitCode: 124,
      signal: null,
      timedOut: true,
    };
  }

  // SSH connection error: exit 255
  if (result.status === 255) {
    return {
      stdout,
      stderr: stderr || 'SSH connection failed (exit 255)',
      exitCode: 255,
      signal: null,
      timedOut: false,
    };
  }

  // Normal exit — forward as-is
  return {
    stdout,
    stderr,
    exitCode: result.status,
    signal: result.signal,
    timedOut: false,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Shell-quote a value for safe embedding in a remote command string. */
function shellQuote(value: string): string {
  // Single-quote wrapping with internal single-quote escaping
  return `'${value.replace(/'/g, "'\\''")}'`;
}
