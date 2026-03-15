---
estimated_steps: 5
estimated_files: 3
---

# T01: Implement pushExperimentBranch and contract tests

**Slice:** S02 — Git Code Sync
**Milestone:** M004

## Description

Create `code-sync.ts` as a standalone module with `pushExperimentBranch(basePath, remote?) → SyncResult`. Add `SyncResult` type to types.ts. Write contract tests using real git repos with bare remotes, following the `upstream-sync.test.ts` pattern.

## Steps

1. Add `SyncResult` type to `src/resources/extensions/gsd/types.ts`: `{ pushed: boolean, ref: string, remote: string, error?: string }`
2. Create `src/resources/extensions/gsd/code-sync.ts`:
   - Import only `runGit` from `git-service.ts` and `SyncResult` from `types.ts`
   - `pushExperimentBranch(basePath: string, remote = 'origin'): SyncResult`
   - Get current branch via `runGit(basePath, ['branch', '--show-current'])` — empty string means detached HEAD → return error result
   - Get local HEAD via `runGit(basePath, ['rev-parse', 'HEAD'])`
   - Try `runGit(basePath, ['push', remote, branch])` in try/catch — catch captures error message for `SyncResult.error`
   - Verify via `runGit(basePath, ['ls-remote', remote, 'refs/heads/' + branch])` — parse the hash, compare to local HEAD
   - If ls-remote hash matches local HEAD and push didn't throw, return `{ pushed: true, ref: localHead, remote }`
   - If push was already up-to-date (verify by comparing remote ref to local HEAD before push), return `{ pushed: false, ref: localHead, remote }`
3. Create `src/resources/extensions/gsd/tests/code-sync.test.ts`:
   - `setupRepoWithBareRemote()`: create bare repo via `git init --bare`, clone it, make initial commit in clone, push to bare
   - Test: push new commits → `pushed: true`, ref matches local HEAD
   - Test: push when already up-to-date → `pushed: false`, no error
   - Test: detached HEAD → error in SyncResult
   - Test: no remote configured / bad remote name → error in SyncResult
   - Test: diverged branch (someone else pushed) → error in SyncResult
   - Test: custom remote name (not "origin") works
4. Run tests: `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts`
5. Run build: `npm run build`

## Must-Haves

- [ ] `SyncResult` type exported from types.ts
- [ ] `pushExperimentBranch` exported from code-sync.ts
- [ ] Module imports only `runGit` from git-service.ts (no auto.ts, eval-runner.ts, campaign lifecycle)
- [ ] Returns structured `SyncResult`, never throws on expected failures
- [ ] Remote defaults to "origin"
- [ ] No force-push — normal `git push` only
- [ ] Detached HEAD produces error result (not crash)
- [ ] Already-up-to-date produces `pushed: false` (not error)
- [ ] Push failure captures error message in `SyncResult.error`
- [ ] All contract tests pass
- [ ] Build passes clean

## Verification

- `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts` — 0 failures
- `npm run build` — exits 0
- `grep -c 'from.*auto\|from.*eval-runner\|from.*campaign' src/resources/extensions/gsd/code-sync.ts` → 0

## Inputs

- `src/resources/extensions/gsd/git-service.ts` — `runGit()` function (line 159): execFileSync wrapper with basePath scoping
- `src/resources/extensions/gsd/types.ts` — existing type definitions including `ComputeConfig`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — test patterns: bare remote setup, real git operations, assertion helpers
- `src/resources/extensions/gsd/compute-backend.ts` — boundary context: S03/S04 backends will call `pushExperimentBranch()` before `runEval()`

## Expected Output

- `src/resources/extensions/gsd/code-sync.ts` — standalone module exporting `pushExperimentBranch`
- `src/resources/extensions/gsd/tests/code-sync.test.ts` — contract tests with 6+ test cases, all passing
- `src/resources/extensions/gsd/types.ts` — `SyncResult` type added

## Observability Impact

- **New signal:** `SyncResult` type provides structured push outcome — `pushed` (boolean), `ref` (HEAD hash), `remote` (name), `error` (git stderr on failure). Future agents inspect this return value directly.
- **Inspection:** Callers (compute backends in S03/S04) receive actionable error messages from git stderr when push fails — no need to re-run commands to diagnose.
- **Failure state:** All git failures (detached HEAD, bad remote, diverged branch, network) are captured in `SyncResult.error` as strings. The function never throws on expected failures, so callers don't need defensive try/catch.
