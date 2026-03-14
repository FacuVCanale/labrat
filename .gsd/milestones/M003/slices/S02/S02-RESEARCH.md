# S02: Selective Apply & Build Verification — Research

**Date:** 2026-03-14

## Summary

S02 adds the `applyUpstreamCommit(hash)` function and `labrat sync --apply <hash>` CLI flag to cherry-pick a selected upstream commit, verify it compiles and passes tests, and update sync state. The core mechanic is `git cherry-pick --no-commit` — which either succeeds cleanly (commit + build + test → done) or fails with conflicts (extract conflict context for S03, abort cherry-pick, report clearly). The codebase has all the patterns needed: `runGit()` in git-service.ts for git operations, `spawnSync` in eval-runner.ts for subprocess execution, the existing sync CLI handler in cli.ts (lines 197–263) for flag parsing, and atomic state writes (D045) in upstream-sync.ts for tracking applied commits.

The key design constraint from the S02→S03 boundary: S02 must produce `getConflictContext(hash)` returning the conflicting hunks, Labrat's current file content, and the upstream patch — packaged for LLM consumption. This means on conflict, S02 must capture the conflict state (merge markers, original file content, upstream diff) *before* aborting the cherry-pick. The `git diff` output while in conflicted state plus `git show <hash>` for the upstream patch gives S03 everything it needs.

Real upstream analysis shows a clear split: commits touching only `packages/*` (e.g., `328414d` undici dependency, `14050a5` Alibaba provider) cherry-pick cleanly since Labrat hasn't modified those paths. Commits touching the 12 shared GSD extension files (`auto.ts`, `commands.ts`, etc.) will almost always conflict. S02 handles the clean cases end-to-end and builds the conflict extraction infrastructure for S03 to handle the hard cases.

## Recommendation

Build three functions in upstream-sync.ts plus CLI wiring:

1. **`applyUpstreamCommit(basePath, hash)`** — The core apply function:
   - Validate hash exists in `fetchUpstreamCommits()` or at minimum in git history
   - Check hash isn't already in `SyncState.appliedCommits`
   - Run `git cherry-pick --no-commit <hash>`
   - If clean: `git commit -m 'upstream(<short-hash>): <subject>'` → run `verifyAfterApply()` → if pass, update `SyncState.appliedCommits`; if verify fails, revert the commit
   - If conflict: capture conflict context via `getConflictContext()`, abort cherry-pick (`git cherry-pick --abort`), return conflict result
   - Return a structured result: `{ success: boolean, conflicted: boolean, conflictContext?: ConflictContext, verifyResult?: VerifyResult, error?: string }`

2. **`verifyAfterApply(basePath)`** — Build + test runner:
   - Run `npm run build` via `execSync` with timeout (120s for build)
   - If build passes, run the test suite via the same `npm test` pattern or `npx tsx` for specific test files
   - Return `{ buildPassed: boolean, testsPassed: boolean, buildOutput?: string, testOutput?: string, error?: string }`
   - Use `execSync` (not `spawnSync`) matching cli.ts pattern — simpler for commands that should block

3. **`getConflictContext(basePath, hash)`** — Conflict extraction for S03:
   - Call while in conflicted state (before `cherry-pick --abort`)
   - For each conflicting file: read the file with merge markers (`readFileSync`), get Labrat's pre-cherry-pick version (`git show HEAD:<file>`), get the upstream patch (`git show <hash> -- <file>`)
   - Return `{ hash, subject, conflictingFiles: Array<{ path, withMarkers, labratVersion, upstreamPatch }> }`

Wire `--apply <hash>` in cli.ts: add flag parsing, lookup commit info from fetched commits, call `applyUpstreamCommit()`, print result.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Git cherry-pick | `runGit(basePath, ['cherry-pick', '--no-commit', hash])` | Git's own merge machinery — ground truth for conflict detection |
| Cherry-pick abort | `runGit(basePath, ['cherry-pick', '--abort'])` | Standard git cleanup after failed cherry-pick |
| Commit message | `runGit(basePath, ['commit', '-F', '-'], { input: msg })` | Same pattern as `commitExperiment()` in git-service.ts line 567 |
| Build verification | `execSync('npm run build', { cwd, stdio: 'pipe' })` | Same approach as cli.ts line 227 and git-service.ts `runPreMergeCheck()` |
| Test verification | `execSync('npm test', { cwd, stdio: 'pipe' })` | package.json already has `"test"` script that runs all test files |
| File content in conflict | `readFileSync(path)` for merge markers, `runGit(basePath, ['show', 'HEAD:<file>'])` for pre-merge | Standard git plumbing — no custom diffing needed |
| Upstream patch extraction | `runGit(basePath, ['show', hash, '--', file])` or `runGit(basePath, ['diff', hash + '~1', hash, '--', file])` | Git's own diff format — what the LLM needs in S03 |
| State tracking | Existing `readSyncState()`/`writeSyncState()` with `appliedCommits` array | Already implemented in S01 with atomic writes |

## Existing Code and Patterns

- `src/resources/extensions/gsd/upstream-sync.ts` (489 lines) — S02 functions go here. Already has `runGit` import, state read/write, commit fetching. New functions follow the same pure-function-with-git-calls pattern.
- `src/resources/extensions/gsd/git-service.ts` lines 159–172 — `runGit(basePath, args, { allowFailure })` is the only way to run git commands. Returns empty string on failure when `allowFailure: true`. Cherry-pick uses this.
- `src/resources/extensions/gsd/git-service.ts` lines 555–599 — `commitExperiment()`/`revertExperiment()` show the commit + revert patterns. `revertExperiment` uses `git revert --no-commit` then checks staged diff — similar flow to cherry-pick-then-verify.
- `src/resources/extensions/gsd/git-service.ts` lines 505–542 — `runPreMergeCheck()` runs build/test verification via `execSync`. Same subprocess pattern for `verifyAfterApply()`.
- `src/cli.ts` lines 42–84 — CLI flag parsing. Need to add `applyHash?: string` to CliFlags and `--apply <hash>` to the parser.
- `src/cli.ts` lines 197–263 — Existing sync handler. `--apply` path branches before the report-generation path.
- `src/resources/extensions/gsd/commands.ts` lines 367–407 — `/gsd sync` interactive handler. Needs extension for `--apply` or a separate subcommand approach.
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — Test pattern to follow: `setupRepoWithUpstream()` creates synthetic repos with upstream remote. Extend with cherry-pick scenarios.
- `src/resources/extensions/gsd/eval-runner.ts` lines 41–59 — `runEval()` uses `spawnSync` with timeout. Reference for timeout-guarded subprocess execution.

## Constraints

- **Cherry-pick requires common ancestry** — `git cherry-pick` needs the commit's parent to exist in the repo's history. For the real Labrat repo, upstream commits have a shared ancestor (ac6f27e, the fork point), so this works. For test repos with unrelated histories, cherry-pick will fail. Test setup must use `git clone` (as `setupRepoWithUpstream()` already does), not independent `git init`.
- **D055 decoupling** — upstream-sync.ts must not import from auto.ts, eval-runner.ts, or campaign lifecycle. Build/test verification uses `execSync` directly (or `runGit` for git commands), not eval-runner's `runEval()`.
- **Dirty working tree aborts cherry-pick** — `git cherry-pick --no-commit` modifies the working tree and index. If there are uncommitted changes, it will fail or produce unexpected results. Should check for clean working tree before attempting.
- **Build timeout** — `npm run build` for this monorepo can take 30–60 seconds. `npm test` runs 59 test files and takes longer. Need reasonable timeouts (120s build, 300s tests) to avoid hanging.
- **Conflict state must be captured before abort** — Once `git cherry-pick --abort` runs, the merge markers in files are gone. `getConflictContext()` must read conflicted files *before* the abort.
- **`appliedCommits` tracking** — SyncState already has the `appliedCommits` field (S01 created it, never populated it). S02 writes to it after successful apply + verify.
- **Commit message convention** — Applied upstream commits should use a distinct convention: `upstream(<short-hash>): <subject>` — distinguishable from experiment commits (`experiment(E001):`) and development commits (`feat:`, `fix:`).
- **Non-fatal** — Sync apply failures must never break the research loop (D055). The apply function returns a result object, never throws unhandled errors.

## Common Pitfalls

- **Forgetting to abort after conflict detection** — If `cherry-pick --no-commit` produces conflicts and the function returns early without `cherry-pick --abort`, the repo is left in a conflicted state. Every conflict exit path must abort.
- **Testing with `git init` instead of `git clone`** — Cherry-pick needs parent commits in the history. A repo created with independent `git init` won't have the upstream commit's parent. `setupRepoWithUpstream()` from S01 uses `git clone` which gives shared history — use it.
- **Running build verification on the test repo** — Test repos don't have `package.json` with build scripts. `verifyAfterApply()` needs to handle missing build commands gracefully. Contract tests should test the function's error handling, not actually run `npm run build`.
- **Large stdout from build/test commands** — `execSync` with `stdio: 'pipe'` can buffer large output. The 10MB `maxBuffer` from eval-runner.ts is a good reference. Truncate output in results to avoid bloating state.
- **Race with concurrent processes** — If `labrat auto` is running, a `labrat sync --apply` modifying the working tree would be dangerous. Should check for lock file / active session before applying.
- **Verify failure leaves applied commit** — If build passes but tests fail after committing the cherry-pick, the commit must be reverted. The revert-on-verify-failure path must be tested.

## Open Risks

- **Package-lock.json conflicts** — Even "clean" upstream commits touching `package.json`/`package-lock.json` may conflict with Labrat's own dependency changes. These are the most common false-conflict files. Consider special handling or warning.
- **Build verification accuracy** — `npm run build` catches TypeScript compilation errors but not runtime issues. `npm test` catches regressions in tested paths but coverage isn't 100%. An applied upstream commit could introduce subtle runtime issues that pass both checks.
- **Long verification times** — Full `npm test` runs 59 test files. On CI-constrained environments this could take 2–5 minutes. Consider offering `--skip-verify` flag for users who want to verify manually.
- **Interactive command `/gsd sync --apply`** — The interactive command handler in commands.ts currently takes no arguments. Need to decide: extend `/gsd sync` to accept `--apply <hash>` or create a separate interactive command. Extending is simpler and follows the CLI pattern.
- **Stale upstream refs** — If user runs `--apply` without fetching first, the commit hash might not exist locally. The `--no-fetch` flag interaction with `--apply` needs to be clear.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Git cherry-pick / conflict resolution | `duc01226/easyplatform@git-conflict-resolve` | available (27 installs — too generic, low adoption) |
| Git worktrees | `neolabhq/context-engineering-kit@worktrees` | available (20 installs — not relevant) |

No skills installed — the cherry-pick + verify workflow is straightforward git plumbing that doesn't benefit from external skills.

## Sources

- `git cherry-pick --no-commit` behavior: verified via `man git-cherry-pick` — modifies working tree and index without committing; conflicts leave merge markers in files; `--abort` restores pre-cherry-pick state
- Upstream commit analysis: `git log ac6f27e..upstream/main --no-merges` — identified clean candidates (328414d, 14050a5, 5fcee41) and conflicting ones (d489ebc, c1026123 touching auto.ts)
- Build/test scripts: `package.json` has `"build": "npm run build:pi && tsc && npm run copy-themes"` and `"test": "node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/*.test.ts ..."`
- Git-service patterns: `runPreMergeCheck()` (line 511), `commitExperiment()` (line 555), `revertExperiment()` (line 582) — all in git-service.ts
- S01 forward intelligence: conflict detection via file-overlap is approximate; S02 should use `git cherry-pick --no-commit` dry-run for real accuracy
- SyncState.appliedCommits: exists in types.ts (line 325) but never populated by S01 — S02 must write to it
