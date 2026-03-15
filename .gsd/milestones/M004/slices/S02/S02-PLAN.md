# S02: Git Code Sync

**Goal:** `pushExperimentBranch()` pushes the current experiment branch to a git remote and verifies the remote ref matches local HEAD.
**Demo:** Contract tests prove push success, already-up-to-date no-op, detached HEAD error, missing remote error, and push failure — all using real git repos with bare remotes.

## Must-Haves

- `code-sync.ts` module exports `pushExperimentBranch(basePath, remote?) → SyncResult`
- Uses `runGit()` from `git-service.ts` — no new dependencies (D064)
- Module imports only `runGit` — no coupling to auto.ts, eval-runner.ts, or campaign lifecycle (D039/D055)
- Returns structured `SyncResult` (not exceptions) so callers handle push failures as discard reasons (D066)
- Remote defaults to `"origin"` consistent with GitPreferences.remote pattern
- Normal `git push` only — no force-push (D063)
- Detached HEAD detected and reported as error
- Already-up-to-date produces `pushed: false` (not an error)
- Push failure captures the error message in `SyncResult.error`

## Verification

- `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts` — all assertions pass
- Tests cover: successful push, already-up-to-date, detached HEAD, missing remote, push failure (diverged branch), custom remote name
- `npm run build` passes (no type errors)

## Tasks

- [x] **T01: Implement pushExperimentBranch and contract tests** `est:30m`
  - Why: This is the entire slice — one module, one function, one test file. The function is ~50 lines and the test patterns are proven by upstream-sync.test.ts.
  - Files: `src/resources/extensions/gsd/code-sync.ts`, `src/resources/extensions/gsd/tests/code-sync.test.ts`, `src/resources/extensions/gsd/types.ts`
  - Do: Add `SyncResult` type to types.ts. Create `code-sync.ts` with `pushExperimentBranch` that: (1) gets current branch via `git branch --show-current`, errors on detached HEAD, (2) pushes `<remote> <branch>`, (3) verifies via `git ls-remote` that remote ref matches local HEAD. Use try/catch around `runGit` (not `allowFailure`) to capture error messages. Create test file with real git repos: `setupRepoWithBareRemote()` creates bare remote + cloned working repo. Test cases: push new commits, no-op when up-to-date, detached HEAD error, no remote configured, diverged branch push failure, custom remote name.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts` passes all assertions; `npm run build` clean
  - Done when: All test cases pass, build passes, module has zero imports from auto.ts/eval-runner.ts/campaign modules

## Observability / Diagnostics

- **Runtime signals:** `SyncResult` struct carries `pushed`, `ref`, `remote`, and `error` — callers inspect the result directly without try/catch. No stderr/stdout side effects during normal operation.
- **Inspection surface:** `SyncResult.error` contains the git stderr message on push failure, enabling downstream agents to diagnose without re-running the push. `SyncResult.ref` is the local HEAD hash at push time for audit trail.
- **Failure visibility:** Detached HEAD → `{ pushed: false, error: 'Detached HEAD...' }`. Bad remote → `{ pushed: false, error: '<git stderr>' }`. Diverged branch → `{ pushed: false, error: '<rejection message>' }`. All failures are structured, never thrown.
- **Redaction constraints:** None — no secrets flow through this module. Remote URLs may contain tokens in CI but are not logged by `pushExperimentBranch` (only the remote name is stored in the result).

## Files Likely Touched

- `src/resources/extensions/gsd/code-sync.ts`
- `src/resources/extensions/gsd/tests/code-sync.test.ts`
- `src/resources/extensions/gsd/types.ts`
