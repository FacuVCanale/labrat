# S02: Git Code Sync — UAT

**Milestone:** M004
**Written:** 2026-03-15

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: `pushExperimentBranch` is a pure function operating on real git repos. Contract tests with bare remotes exercise all failure modes without needing a live server. The function has no UI, no network calls beyond local git, and no side effects beyond git operations.

## Preconditions

- Node.js and npm installed
- Repository cloned and `npm install` complete
- `npx tsx` available (ships with project dependencies)

## Smoke Test

Run the contract test suite:
```
npx tsx src/resources/extensions/gsd/tests/code-sync.test.ts
```
Expected: `Passed: 23, Failed: 0`

## Test Cases

### 1. Successful push of new commits

1. Create a bare remote + cloned working repo
2. Make a new commit in the working repo
3. Call `pushExperimentBranch(workingRepoPath)`
4. **Expected:** `{ pushed: true, ref: <localHEAD>, remote: 'origin' }` — no `error` field. Running `git ls-remote origin refs/heads/main` in the working repo shows the same hash as local HEAD.

### 2. Already up-to-date (no-op)

1. Push once to sync remote and local
2. Call `pushExperimentBranch(workingRepoPath)` again without new commits
3. **Expected:** `{ pushed: false, ref: <localHEAD>, remote: 'origin' }` — no `error` field. No unnecessary push performed.

### 3. Detached HEAD detection

1. Run `git checkout --detach HEAD` in the working repo
2. Call `pushExperimentBranch(workingRepoPath)`
3. **Expected:** `{ pushed: false, ref: '', remote: 'origin', error: 'Detached HEAD — no branch to push' }`

### 4. Bad remote name

1. Call `pushExperimentBranch(workingRepoPath, 'nonexistent-remote')`
2. **Expected:** `{ pushed: false, ref: <localHEAD>, remote: 'nonexistent-remote', error: <contains git error message about missing remote> }`

### 5. Diverged branch rejection

1. Push initial state to remote
2. Create a divergent commit directly on the bare remote (via a second clone)
3. Create a different commit in the working repo
4. Call `pushExperimentBranch(workingRepoPath)`
5. **Expected:** `{ pushed: false, ref: <localHEAD>, remote: 'origin', error: <contains 'rejected' or 'non-fast-forward'> }` — no force-push attempted.

### 6. Custom remote name

1. Add a second bare remote as `upstream` to the working repo
2. Make a new commit
3. Call `pushExperimentBranch(workingRepoPath, 'upstream')`
4. **Expected:** `{ pushed: true, ref: <localHEAD>, remote: 'upstream' }`

## Edge Cases

### No remote configured at all

1. Create a standalone git repo with no remotes
2. Call `pushExperimentBranch(repoPath)`
3. **Expected:** `{ pushed: false, ref: <localHEAD>, remote: 'origin', error: <contains git error about missing remote> }`

### Empty repository (no commits)

1. Create a git repo with `git init` but no commits
2. Call `pushExperimentBranch(repoPath)`
3. **Expected:** Error result — `rev-parse HEAD` fails on empty repo, captured in `SyncResult.error`

## Failure Signals

- Any test case returning `{ pushed: true }` when it should be `false` (or vice versa)
- Missing `error` field when an error was expected
- Uncaught exception instead of structured `SyncResult`
- `SyncResult.ref` not matching actual `git rev-parse HEAD`
- Module importing from `auto.ts`, `eval-runner.ts`, or any campaign lifecycle module

## Requirements Proved By This UAT

- R032 (Code Sync via Git) — Push experiment branch to origin, verify remote matches local HEAD, structured error handling for all failure modes, no-op when up-to-date

## Not Proven By This UAT

- Integration with SSH/Docker backends calling `pushExperimentBranch` before remote eval (S03/S04)
- Performance under large repositories (latency constraint: <2s for small diffs — not measured, deferred to integration)
- Network-level failures (DNS, timeout) — only local git transport tested

## Notes for Tester

- All test cases are automated in `code-sync.test.ts` — running the test suite covers cases 1-6 and the "no remote" edge case
- The "empty repository" edge case is not in the automated suite — test manually if desired
- Pre-existing build errors in `compute-backend.ts` (from S01) are expected and unrelated to S02
