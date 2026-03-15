/**
 * GSD Docker Compute Backend — Runs eval commands inside Docker containers.
 *
 * Two code paths:
 *   Local  (no dockerHost): volume mount cwd at /workspace, run directly.
 *   Remote (dockerHost set): push experiment branch, git clone inside container.
 *
 * Exit code mapping:
 *   124        → timedOut:true (remote/local `timeout` command killed the eval)
 *   125        → Docker daemon error (stderr preserved)
 *   126        → command not invokable (stderr preserved)
 *   127        → command not found (stderr preserved)
 *   ETIMEDOUT  → timedOut:true (spawnSync safety-net killed the process)
 *   SIGTERM/SIGKILL → timedOut:true (spawnSync safety-net)
 *   other      → forwarded as-is
 */

import { spawnSync } from 'node:child_process';

import type { ComputeConfig, SyncResult } from './types.js';
import type { RunEvalResult } from './eval-runner.js';
import type { ComputeBackend, ComputeEvalOpts } from './compute-backend.js';
import { pushExperimentBranch } from './code-sync.js';
import { runGit } from './git-service.js';

// ─── Config type guard ──────────────────────────────────────────────────────

export type DockerBackendConfig = Extract<ComputeConfig, { type: 'docker' }>;

// ─── Docker Backend ─────────────────────────────────────────────────────────

/**
 * Runs eval commands inside a Docker container via `docker run`.
 *
 * Local path (no dockerHost):
 *   Mounts cwd as /workspace, runs command with `timeout` wrapper.
 *
 * Remote path (dockerHost set):
 *   1. Pushes experiment branch via pushExperimentBranch()
 *   2. Runs container on remote daemon with git clone + checkout
 *   3. Requires repoUrl — returns structured error if missing
 *
 * Safety-net timeout: timeoutSecs + 60s (Docker startup overhead).
 */
export class DockerBackend implements ComputeBackend {
  private readonly config: DockerBackendConfig;

  constructor(config: DockerBackendConfig) {
    this.config = config;
  }

  runEval(opts: ComputeEvalOpts): RunEvalResult {
    if (this.config.dockerHost) {
      return this.runRemote(opts);
    }
    return this.runLocal(opts);
  }

  private runLocal(opts: ComputeEvalOpts): RunEvalResult {
    // Build docker run args: docker run --rm -w /workspace -v <cwd>:/workspace [--gpus] [-e K=V] [extra -v] <image> sh -c 'timeout <secs> <command>'
    const args: string[] = ['run', '--rm', '-w', '/workspace'];

    // Volume mount: cwd → /workspace
    args.push('-v', `${opts.cwd}:/workspace`);

    // Extra volumes from config
    if (this.config.volumes) {
      for (const vol of this.config.volumes) {
        args.push('-v', vol);
      }
    }

    // GPU passthrough
    if (this.config.gpus) {
      args.push('--gpus', this.config.gpus);
    }

    // Environment variables
    if (opts.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Image + command with timeout wrapper
    args.push(this.config.image, 'sh', '-c', `timeout ${opts.timeoutSecs} ${opts.command}`);

    // Execute with safety-net timeout (+60s for Docker startup overhead)
    const safetyNetMs = (opts.timeoutSecs + 60) * 1000;
    const result = spawnSync('docker', args, {
      timeout: safetyNetMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'utf-8',
    });

    return mapDockerResult(result);
  }

  private runRemote(opts: ComputeEvalOpts): RunEvalResult {
    // Remote path requires repoUrl — fail early with actionable error
    if (!this.config.repoUrl) {
      return {
        stdout: '',
        stderr: 'Docker remote mode requires "repoUrl" in compute config — set it to the git remote URL accessible from the Docker host',
        exitCode: 1,
        signal: null,
        timedOut: false,
      };
    }

    // 1. Push experiment branch
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

    // 2. Get current branch + HEAD ref for git checkout inside container
    let branch: string;
    let ref: string;
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
    try {
      ref = runGit(opts.cwd, ['rev-parse', 'HEAD']);
    } catch (err) {
      return {
        stdout: '',
        stderr: `Failed to get HEAD ref: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      };
    }

    // 3. Build docker -H <host> run args
    const args: string[] = ['-H', this.config.dockerHost!, 'run', '--rm'];

    // GPU passthrough
    if (this.config.gpus) {
      args.push('--gpus', this.config.gpus);
    }

    // Environment variables
    if (opts.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Build the inner command: git clone → checkout ref → timeout eval
    const innerCommand = [
      `git clone ${shellQuote(this.config.repoUrl)} /workspace`,
      `cd /workspace`,
      `git checkout ${shellQuote(ref)}`,
      `timeout ${opts.timeoutSecs} ${opts.command}`,
    ].join(' && ');

    args.push(this.config.image, 'sh', '-c', innerCommand);

    // Execute with safety-net timeout (+60s for Docker startup overhead)
    const safetyNetMs = (opts.timeoutSecs + 60) * 1000;
    const result = spawnSync('docker', args, {
      timeout: safetyNetMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'utf-8',
    });

    return mapDockerResult(result);
  }
}

// ─── Result Mapping ─────────────────────────────────────────────────────────

/**
 * Map spawnSync result to RunEvalResult with Docker-specific exit code handling.
 *
 * - spawnSync error with code ETIMEDOUT → safety-net timeout fired
 * - signal SIGTERM/SIGKILL → spawnSync killed the process (safety-net)
 * - exit 124 → remote `timeout` command killed the eval
 * - exit 125 → Docker daemon error (stderr preserved)
 * - exit 126 → command not invokable (stderr preserved)
 * - exit 127 → command not found (stderr preserved)
 * - otherwise → forward exit code as-is
 */
function mapDockerResult(result: ReturnType<typeof spawnSync>): RunEvalResult {
  const stdout = (result.stdout as string) ?? '';
  const stderr = (result.stderr as string) ?? '';

  // Safety-net timeout: spawnSync killed the docker process
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return {
      stdout,
      stderr: stderr || 'Docker command timed out (safety-net timeout)',
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

  // Docker daemon error: exit 125
  if (result.status === 125) {
    return {
      stdout,
      stderr: stderr || 'Docker daemon error (exit 125)',
      exitCode: 125,
      signal: null,
      timedOut: false,
    };
  }

  // Command not invokable: exit 126
  if (result.status === 126) {
    return {
      stdout,
      stderr: stderr || 'Command not invokable (exit 126)',
      exitCode: 126,
      signal: null,
      timedOut: false,
    };
  }

  // Command not found: exit 127
  if (result.status === 127) {
    return {
      stdout,
      stderr: stderr || 'Command not found (exit 127)',
      exitCode: 127,
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

/** Shell-quote a value for safe embedding in a command string. */
function shellQuote(value: string): string {
  // Single-quote wrapping with internal single-quote escaping
  return `'${value.replace(/'/g, "'\\''")}'`;
}
