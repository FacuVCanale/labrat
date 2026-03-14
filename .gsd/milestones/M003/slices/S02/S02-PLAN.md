# S02: Selective Apply & Build Verification

**Goal:** `applyUpstreamCommit(hash)` cherry-picks a selected upstream commit, runs build+test verification, updates sync state — with conflict detection that extracts context for S03's LLM adaptation pipeline.

**Demo:** Running `labrat sync --apply <hash>` on a non-conflicting upstream commit cherry-picks it, verifies the build compiles and tests pass, records the commit in `SyncState.appliedCommits`, and prints a success report. Running it on a conflicting commit reports which files conflict, extracts the conflict context (merge markers, Labrat version, upstream patch), aborts cleanly, and prints a structured conflict report.

## Must-Haves

- `applyUpstreamCommit(basePath, hash)` attempts cherry-pick, handles clean/conflict paths, returns structured result
- `verifyAfterApply(basePath)` runs `npm run build` + `npm test` with timeouts, returns pass/fail with output
- `getConflictContext(basePath, hash)` extracts conflicting hunks, Labrat's file content, and upstream patch before cherry-pick abort
- `SyncState.appliedCommits` updated after successful apply+verify
- Already-applied commits rejected without re-applying
- Conflict paths always abort cherry-pick (never leave repo in conflicted state)
- Verify failure after clean cherry-pick reverts the commit
- `--apply <hash>` CLI flag on `labrat sync` with clear success/conflict/error reporting
- `/gsd sync --apply <hash>` interactive command path
- All functions non-fatal (return result objects, never throw unhandled errors) per D055

## Proof Level

- This slice proves: contract + operational
- Real runtime required: no (contract tests use synthetic git repos; build/test verification tested via error handling, not actual `npm run build`)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — all existing 63 assertions + new S02 assertions pass
- `npm run build` — compiles clean with new types and functions
- `node dist/cli.js sync --help` — shows `--apply <hash>` in help text
- Contract tests verify `ApplyResult.error` is populated on failure paths and `ApplyResult.conflictContext.conflictingFiles` contains structured data (withMarkers, labratVersion, upstreamPatch) on conflict paths — confirming inspectable failure state

## Observability / Diagnostics

- Runtime signals: `applyUpstreamCommit()` returns `ApplyResult` with `{ success, conflicted, conflictContext?, verifyResult?, error? }` — every outcome is inspectable
- Inspection surfaces: `cat .gsd/UPSTREAM-SYNC.json` shows `appliedCommits` array after successful apply; `labrat sync --apply <hash>` prints structured result to stdout
- Failure visibility: conflict context includes per-file merge markers, Labrat version, upstream patch — all the data S03 needs for LLM dispatch

## Integration Closure

- Upstream surfaces consumed: `UpstreamCommitInfo` and `SyncState` types from S01, `readSyncState()`/`writeSyncState()` for state persistence, `runGit()` from git-service.ts for git operations, `fetchUpstreamCommits()` for commit validation
- New wiring introduced: `--apply <hash>` flag in cli.ts, apply handler branch in sync CLI block, interactive command apply path in commands.ts
- What remains before the milestone is truly usable end-to-end: S03 (LLM-assisted conflict adaptation) — S02 detects and reports conflicts but doesn't resolve them

## Tasks

- [x] **T01: Implement apply, verify, and conflict-context functions with contract tests** `est:45m`
  - Why: Core cherry-pick mechanics are the primary risk — must prove clean apply, conflict extraction, revert-on-failure, and state tracking all work correctly before wiring CLI
  - Files: `src/resources/extensions/gsd/upstream-sync.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/upstream-sync.test.ts`
  - Do: Add `ApplyResult`, `VerifyResult`, `ConflictContext` types to types.ts. Implement three functions in upstream-sync.ts: `applyUpstreamCommit` (cherry-pick → verify → commit or conflict-extract → abort), `verifyAfterApply` (execSync build+test with timeouts), `getConflictContext` (read merge markers + git show for upstream patch). Add contract tests using `setupRepoWithUpstream()` covering: clean cherry-pick path, conflict path with context extraction, already-applied rejection, verify-fail revert, dirty-tree guard, appliedCommits state update. Every conflict exit path must call `cherry-pick --abort`. Capture conflict context BEFORE abort.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — all S01 + S02 assertions pass
  - Done when: All three functions exported, contract tests pass for clean/conflict/error paths, `npm run build` clean

- [x] **T02: Wire --apply flag into CLI and interactive command** `est:20m`
  - Why: Users need the `labrat sync --apply <hash>` entrypoint — the functions from T01 are useless without CLI access
  - Files: `src/cli.ts`, `src/resources/extensions/gsd/commands.ts`
  - Do: Add `applyHash?: string` to CliFlags, `--apply <hash>` to flag parser, help text update. Branch in sync handler: if `applyHash`, import `applyUpstreamCommit`, call it, print structured result (success/conflict/error), exit. Extend `/gsd sync` interactive handler to accept `--apply <hash>` argument. Follow existing sync handler pattern — dynamic import, basePath = cwd, fetch-then-apply.
  - Verify: `npm run build` clean, `node dist/cli.js sync --help` shows --apply, help text is correct
  - Done when: `--apply <hash>` flag parses correctly, handler calls `applyUpstreamCommit`, result printed, build passes

## Files Likely Touched

- `src/resources/extensions/gsd/upstream-sync.ts`
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts`
- `src/cli.ts`
- `src/resources/extensions/gsd/commands.ts`
