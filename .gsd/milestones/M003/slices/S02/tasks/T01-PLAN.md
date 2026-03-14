---
estimated_steps: 7
estimated_files: 3
---

# T01: Implement apply, verify, and conflict-context functions with contract tests

**Slice:** S02 — Selective Apply & Build Verification
**Milestone:** M003

## Description

Implement the three core S02 functions in upstream-sync.ts — `applyUpstreamCommit()`, `verifyAfterApply()`, and `getConflictContext()` — plus their supporting types and comprehensive contract tests. This is the high-risk work: cherry-pick mechanics, conflict state capture timing (must read merge markers before abort), revert-on-verify-failure, and appliedCommits state tracking.

## Steps

1. Add new types to `types.ts`: `ApplyResult` (`{ success, conflicted, conflictContext?, verifyResult?, error? }`), `VerifyResult` (`{ buildPassed, testsPassed, buildOutput?, testOutput?, error? }`), `ConflictContext` (`{ hash, subject, conflictingFiles: Array<{ path, withMarkers, labratVersion, upstreamPatch }> }`).

2. Implement `verifyAfterApply(basePath)` in upstream-sync.ts: run `npm run build` via `execSync` (120s timeout, 10MB maxBuffer), if pass run `npm test` (300s timeout), return `VerifyResult`. Handle missing scripts gracefully (treat as pass with skip note). Truncate large output in results.

3. Implement `getConflictContext(basePath, hash)` in upstream-sync.ts: for each file reported by `git diff --name-only --diff-filter=U` (unmerged files), read file content (has merge markers) via `readFileSync`, get Labrat's pre-cherry-pick version via `git show HEAD:<file>`, get upstream patch via `git diff <hash>~1 <hash> -- <file>`. Return structured `ConflictContext`.

4. Implement `applyUpstreamCommit(basePath, hash)` in upstream-sync.ts: validate hash not in `appliedCommits`, check clean working tree (`git status --porcelain`), run `git cherry-pick --no-commit <hash>`. If clean (exit 0): `git commit -m 'upstream(<short>): <subject>'` → `verifyAfterApply()` → if verify passes, update `SyncState.appliedCommits` and write state; if verify fails, `git revert --no-commit HEAD` + `git commit`. If conflict (non-zero exit): `getConflictContext()` → `git cherry-pick --abort` → return conflict result. All paths wrapped in try/catch, never throws.

5. Add contract tests to upstream-sync.test.ts using `setupRepoWithUpstream()`:
   - Clean cherry-pick: add a packages/ file in upstream, cherry-pick in work repo → success, file exists, appliedCommits updated
   - Conflict path: modify same file in both repos, cherry-pick → conflicted result with context containing merge markers, repo left clean after abort
   - Already-applied rejection: apply same hash twice → error result without re-applying
   - Verify failure path: mock verify by cherry-picking into repo without package.json → verify returns appropriate result
   - State persistence: after successful apply, readSyncState shows hash in appliedCommits
   - getConflictContext: verify structure has withMarkers, labratVersion, upstreamPatch fields

6. Run tests: `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — all existing S01 + new S02 assertions pass.

7. Run `npm run build` to verify compilation.

## Must-Haves

- [ ] `ApplyResult`, `VerifyResult`, `ConflictContext` types exported from types.ts
- [ ] `applyUpstreamCommit(basePath, hash)` handles clean/conflict/error paths, never throws
- [ ] `verifyAfterApply(basePath)` runs build+test with timeouts, returns structured result
- [ ] `getConflictContext(basePath, hash)` extracts merge markers, Labrat version, upstream patch per conflicting file
- [ ] Every conflict/error exit path in `applyUpstreamCommit` calls `cherry-pick --abort` (no orphaned conflict state)
- [ ] Verify failure after clean cherry-pick reverts the committed change
- [ ] `SyncState.appliedCommits` updated only after successful apply+verify
- [ ] Already-applied commits rejected without side effects
- [ ] Contract tests cover all paths: clean, conflict, already-applied, verify-fail, state persistence

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → all S01 (63) + S02 assertions pass, 0 failures
- `npm run build` → compiles clean

## Observability Impact

- Signals added: `ApplyResult` object with `success`, `conflicted`, `error` fields — every outcome is a structured value, not an exception
- How a future agent inspects this: `readSyncState(basePath).appliedCommits` to see what's been applied; `ApplyResult.conflictContext` to see exactly what conflicted and why
- Failure state exposed: `ApplyResult.error` for unexpected failures, `ApplyResult.conflictContext.conflictingFiles[].withMarkers` for conflict details

## Inputs

- `src/resources/extensions/gsd/upstream-sync.ts` — S01's module with classification, state, fetch functions
- `src/resources/extensions/gsd/types.ts` — existing `UpstreamCommitInfo`, `SyncState`, `CommitCategory` types
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — existing test harness with `setupRepoWithUpstream()`, `assert()`, `assertEq()`
- `src/resources/extensions/gsd/git-service.ts` — `runGit()` function for git operations

## Expected Output

- `src/resources/extensions/gsd/types.ts` — with `ApplyResult`, `VerifyResult`, `ConflictContext` types added
- `src/resources/extensions/gsd/upstream-sync.ts` — with `applyUpstreamCommit`, `verifyAfterApply`, `getConflictContext` exported
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — with S02 contract tests added (6+ test scenarios, 20+ new assertions)
