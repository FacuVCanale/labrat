// GSD Extension — Code Sync
// Pushes experiment branches to a git remote and verifies the remote ref matches local HEAD.
// Standalone module — imports only runGit from git-service.ts.

import { runGit } from './git-service.js';
import type { SyncResult } from './types.js';

/**
 * Push the current branch to a git remote and verify the remote ref matches local HEAD.
 *
 * Returns a structured SyncResult — never throws on expected failures.
 * - Detached HEAD → error result
 * - Already up-to-date → { pushed: false }
 * - Push failure (diverged, bad remote, network) → error with git stderr
 * - Success → { pushed: true, ref: localHead }
 */
export function pushExperimentBranch(basePath: string, remote = 'origin'): SyncResult {
  // 1. Get current branch — empty means detached HEAD
  let branch: string;
  try {
    branch = runGit(basePath, ['branch', '--show-current']);
  } catch (err) {
    return { pushed: false, ref: '', remote, error: `Failed to get current branch: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!branch) {
    return { pushed: false, ref: '', remote, error: 'Detached HEAD — no branch to push' };
  }

  // 2. Get local HEAD hash
  let localHead: string;
  try {
    localHead = runGit(basePath, ['rev-parse', 'HEAD']);
  } catch (err) {
    return { pushed: false, ref: '', remote, error: `Failed to get local HEAD: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 3. Check remote ref before push to detect already-up-to-date
  let remoteRefBefore = '';
  try {
    const lsOutput = runGit(basePath, ['ls-remote', remote, `refs/heads/${branch}`]);
    if (lsOutput) {
      // ls-remote output: "<hash>\trefs/heads/<branch>"
      remoteRefBefore = lsOutput.split(/\s/)[0] ?? '';
    }
  } catch {
    // ls-remote failure is fine — remote might not have this branch yet, or remote might not exist.
    // We'll find out during push.
  }

  // 4. If remote already matches local HEAD, no push needed
  if (remoteRefBefore === localHead) {
    return { pushed: false, ref: localHead, remote };
  }

  // 5. Push
  try {
    runGit(basePath, ['push', remote, branch]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pushed: false, ref: localHead, remote, error: message };
  }

  // 6. Verify remote ref after push
  try {
    const lsOutput = runGit(basePath, ['ls-remote', remote, `refs/heads/${branch}`]);
    const remoteRefAfter = lsOutput ? lsOutput.split(/\s/)[0] ?? '' : '';

    if (remoteRefAfter === localHead) {
      return { pushed: true, ref: localHead, remote };
    }

    // Push succeeded but remote doesn't match — unexpected
    return {
      pushed: false,
      ref: localHead,
      remote,
      error: `Push appeared to succeed but remote ref (${remoteRefAfter || 'empty'}) does not match local HEAD (${localHead})`,
    };
  } catch (err) {
    // Push succeeded but verification failed — report as successful push with a note
    return {
      pushed: true,
      ref: localHead,
      remote,
      error: `Push succeeded but verification via ls-remote failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
