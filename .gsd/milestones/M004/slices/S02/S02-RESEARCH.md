# S02: Git Code Sync — Research

**Date:** 2026-03-15

## Summary

S02 delivers `pushExperimentBranch()` — a standalone function that pushes the current experiment branch to a git remote before remote eval dispatch. The implementation is straightforward: detect current branch, push to remote, verify the remote ref matches local HEAD. The codebase already has all the primitives needed (`runGit()` for subprocess git, `getCurrentBranch()` for branch detection, push patterns in `mergeSliceToMain()`).

The main design question is where this module lives and how it reports results. Following the `upstream-sync.ts` pattern (D055/D039), this should be a standalone `code-sync.ts` module that imports only `runGit` from `git-service.ts`. It returns a structured `SyncResult` rather than throwing, so callers (S03 SSH backend, S04 Docker backend) can handle push failures as discard reasons rather than crashes (D066).

The test strategy is proven by `git-experiment.test.ts` and `upstream-sync.test.ts`: real git repos in temp directories with bare remotes for push verification. No mocking needed — git operations are fast and deterministic.

## Recommendation

Create `code-sync.ts` as a standalone module with a single exported function `pushExperimentBranch(basePath: string, remote?: string): SyncResult`. Use `runGit()` directly for all git operations. Return structured results, not exceptions. Test with real git repos including bare remotes.

Implementation approach:
1. `getCurrentBranch` via `git branch --show-current`
2. `git push <remote> <branch>` with error capture
3. Verify remote ref via `git ls-remote <remote> <branch>` matches local HEAD
4. Handle already-up-to-date (no-op), success, and failure as distinct `SyncResult` states

Keep it simple — no retry logic, no force-push, no ControlMaster concerns. Those belong to the backends that consume this function.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Git subprocess execution | `runGit()` from `git-service.ts` | Consistent error handling, basePath scoping, allowFailure pattern |
| Branch name detection | `git branch --show-current` via runGit | Same pattern used everywhere in GitServiceImpl |
| Remote name resolution | `prefs.remote ?? "origin"` pattern | Consistent with `ensureSliceBranch` (line 465) and `mergeSliceToMain` (line 845) |
| Push to remote | `git push <remote> <branch>` | Already used in mergeSliceToMain auto-push |

## Existing Code and Patterns

- `src/resources/extensions/gsd/git-service.ts` — `runGit()` (line 159) is the git subprocess primitive. `allowFailure: true` returns empty string on error, otherwise throws with descriptive message. All git operations in the codebase go through this.
- `src/resources/extensions/gsd/git-service.ts` — `mergeSliceToMain()` (line 843-851) has the existing push pattern: `this.git(["push", remote, mainBranch], { allowFailure: true })`. Remote defaults to `this.prefs.remote ?? "origin"`.
- `src/resources/extensions/gsd/upstream-sync.ts` — Module extraction pattern (D039/D055): standalone .ts file, imports only `runGit` from git-service.ts, no coupling to auto.ts or eval-runner.ts. This is the template for code-sync.ts.
- `src/resources/extensions/gsd/compute-backend.ts` — `resolveBackend()` is the factory where backends get resolved. S03/S04 backends will call `pushExperimentBranch()` before `runEval()`.
- `src/resources/extensions/gsd/worktree.ts` — `getCurrentBranch()` (line 135) delegates to `GitServiceImpl.getCurrentBranch()`. But code-sync.ts should use `runGit` directly to avoid coupling to the worktree facade's cached service instance.
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — Test pattern: `setupRepo()` creates temp git repo, `GitServiceImpl` instantiated directly, real git operations, cleanup in finally blocks.
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — Test pattern for remote operations: `setupRepoWithUpstream()` creates bare remote + cloned local, `run()` helper for raw git commands.

## Constraints

- **No force-push** (D063): normal `git push` only. If the remote branch has diverged (someone else pushed), this is an error. The boundary map specifies this explicitly.
- **Synchronous** (milestone constraint): `pushExperimentBranch()` must block and return a result, matching the synchronous `ComputeBackend.runEval()` contract. `execFileSync` via `runGit` handles this.
- **No new dependencies**: uses native git via `runGit` (D064). No Node.js git libraries.
- **Module isolation** (D039/D055 pattern): code-sync.ts must not import from auto.ts, eval-runner.ts, or campaign lifecycle modules. Only `runGit` from git-service.ts.
- **Remote defaults to "origin"**: consistent with GitPreferences.remote pattern throughout the codebase.
- **Push target is current branch**: during experiments, we're on a slice branch like `gsd/M004/S01`. The push sends this exact branch to the remote.

## Common Pitfalls

- **Push to bare remote vs GitHub remote** — `git push` to a bare repo returns different output than to GitHub (no "Branch 'x' set up..." message). Verification should use `git ls-remote` not stdout parsing. The `runGit` return value for push is just stdout which is typically empty on success.
- **First push requires `--set-upstream`** — First push of a new branch to a remote needs `-u` or the full refspec. Without it, `git push origin <branch>` works fine (explicit refspec). Don't rely on tracking configuration.
- **`allowFailure` swallows the error message** — `runGit` with `allowFailure: true` returns empty string on failure, losing the stderr. For `pushExperimentBranch`, we need the error message to surface in `SyncResult.error`. Must use `try/catch` around `runGit` (without `allowFailure`) to capture the full error.
- **Already up-to-date is not an error** — `git push` exits 0 when the remote already has the ref. This should map to `SyncResult.pushed = false` (no new data pushed), not an error. Check via `git ls-remote` comparison before push, or detect from push output.
- **Detached HEAD** — If somehow not on a branch (detached HEAD), `git branch --show-current` returns empty string. Must detect and error clearly.

## Open Risks

- **No remote configured** — If the repo has no remotes at all, push will fail. This is expected for local-only repos, but the error message should be clear: "No git remote 'origin' found. Remote eval requires a git remote for code sync."
- **Auth failures** — SSH key not in agent, HTTPS token expired, etc. These surface as git push errors. The error message from git is usually good enough — just pass it through in `SyncResult.error`.
- **Large push latency for initial push** — First push of a branch with full repo history could be slow. Subsequent pushes are incremental and fast. This matches the roadmap's proof target: "incremental push is fast (<2s for small diffs)".
- **Remote branch protection rules** — Some repos have branch protection on `gsd/*` patterns. This would block the push. Not something we can detect ahead of time — it'll surface as a push error.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Git | github/awesome-copilot@git-commit | not relevant — covers commit conventions, not push/sync |
| TypeScript | n/a | core language, no skill needed |

## Sources

- Existing codebase analysis: git-service.ts push patterns, upstream-sync.ts module isolation, compute-backend.ts interface
- Boundary map in M004-ROADMAP.md specifying `pushExperimentBranch(basePath, remote?) → SyncResult` contract
- D063 (git push/pull for all remote backends), D064 (native CLI over libraries), D066 (backend failure → discard)
