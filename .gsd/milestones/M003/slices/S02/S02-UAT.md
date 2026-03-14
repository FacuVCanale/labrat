# S02: Selective Apply & Build Verification — UAT

**Milestone:** M003
**Written:** 2026-03-14

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All cherry-pick mechanics, conflict detection, and state tracking are proven by 50 contract test assertions using synthetic git repos. CLI wiring verified by build + help text inspection. No live upstream apply needed for S02 — real upstream apply is S03/milestone-level integration.

## Preconditions

- Repository cloned and dependencies installed (`npm install`)
- `npm run build` passes clean
- `npx tsx` available for running tests
- No uncommitted changes in working tree

## Smoke Test

Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — expect 113 passed, 0 failed. This confirms all S01 + S02 contract tests pass.

## Test Cases

### 1. Clean cherry-pick applies and updates state

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: applyUpstreamCommit — clean cherry-pick` section passes
3. **Expected:** `ApplyResult.success === true`, `ApplyResult.conflicted === false`, commit message contains upstream hash and subject, `readSyncState().appliedCommits` includes the applied hash

### 2. Conflict path extracts context and aborts cleanly

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: applyUpstreamCommit — conflict path` section passes
3. **Expected:** `ApplyResult.success === false`, `ApplyResult.conflicted === true`, `conflictContext.conflictingFiles` is non-empty, each file has `withMarkers` containing `<<<<<<<`, `labratVersion` is a string, `upstreamPatch` is a string, repo working tree is clean after abort (no leftover conflict state)

### 3. Already-applied commits rejected

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: applyUpstreamCommit — already-applied rejection` section passes
3. **Expected:** `ApplyResult.success === false`, `ApplyResult.error` contains "already been applied", no cherry-pick attempted

### 4. Verify with no package.json treats as pass

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: verifyAfterApply` section passes
3. **Expected:** `VerifyResult.buildPassed === true`, `VerifyResult.testPassed === true` when no package.json or scripts exist (skip, not fail)

### 5. State persists to disk after successful apply

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: state persistence after apply` section passes
3. **Expected:** `.gsd/UPSTREAM-SYNC.json` on disk contains `appliedCommits` array with the applied hash after `applyUpstreamCommit` completes

### 6. Conflict context structure is complete

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: getConflictContext structure` section passes
3. **Expected:** `ConflictContext` has `hash`, `subject` fields, `conflictingFiles` array where each entry has `path`, `withMarkers`, `labratVersion`, `upstreamPatch` — all strings

### 7. Dirty working tree rejected

1. Run `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts`
2. Observe the `S02: dirty working tree guard` section passes
3. **Expected:** `ApplyResult.success === false`, `ApplyResult.error` indicates dirty working tree, no cherry-pick attempted

### 8. CLI help shows --apply flag

1. Run `npm run build`
2. Run `node dist/cli.js sync --help`
3. **Expected:** Output includes `--apply <hash>` with description "Cherry-pick a specific upstream commit and verify build+tests"

### 9. Build compiles clean with all new types

1. Run `npm run build`
2. **Expected:** Exit code 0, no TypeScript errors, all workspace packages compile

## Edge Cases

### Revert on verify failure

1. Contract test scenario: cherry-pick succeeds but verify returns failure
2. **Expected:** `applyUpstreamCommit` reverts the commit (`git reset --hard HEAD~1`), `ApplyResult.success === false`, `ApplyResult.verifyResult` shows which step failed, working tree is clean

### Multiple sequential applies

1. Apply commit A (succeeds) → apply commit B (succeeds) → try apply commit A again
2. **Expected:** A and B both in `appliedCommits`, second attempt on A returns error "already been applied"

### Empty upstream patch in conflict context

1. Cherry-pick a commit that conflicts, where `git diff hash~1 hash -- file` produces no output for some reason
2. **Expected:** `upstreamPatch` is empty string, not undefined or crash — `getConflictContext` degrades gracefully

## Failure Signals

- Test count drops below 113 — regression in S01 or S02 tests
- `npm run build` fails — type errors in new types or function signatures
- `--apply` not shown in help text — flag parsing not wired correctly
- Any contract test shows `ApplyResult.error` as undefined on a failure path — error reporting gap
- Conflict test shows clean working tree with unresolved merge markers — abort not called

## Requirements Proved By This UAT

- R026 (GSD-2 Upstream Feature Sync) — partially: selective apply mechanics proven (cherry-pick, conflict detection, verify, state tracking). Full validation requires S03 (LLM adaptation).

## Not Proven By This UAT

- Real upstream commit apply against GSD-2 remote — deferred to milestone-level integration verification
- Actual `npm run build` / `npm test` execution after a real cherry-pick — contract tests use synthetic repos without real build systems
- LLM-assisted conflict resolution — S03 scope
- Interactive `/gsd sync --apply` end-to-end — requires running interactive TUI session

## Notes for Tester

- All test scenarios use synthetic git repos created in temp directories — no real upstream interaction needed
- The `verifyAfterApply` function is tested for error handling, not actual build execution — it calls `execSync('npm run build')` which would fail in synthetic repos without package.json, hence the "treat missing as pass" behavior
- Conflict context extraction order matters: markers are read BEFORE `cherry-pick --abort`. If test order changes, ensure conflict state is still active when `getConflictContext` runs.
