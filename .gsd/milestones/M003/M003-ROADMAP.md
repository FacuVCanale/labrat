# M003: Upstream Sync & Ecosystem

**Vision:** A `labrat sync` command that fetches GSD-2 upstream changes, categorizes them as infrastructure-relevant or development-specific, presents a structured report, and enables selective application with LLM-assisted conflict resolution — so Labrat benefits from upstream improvements without manual porting effort.

## Success Criteria

- `labrat sync` fetches upstream changes and displays a categorized terminal report showing infrastructure vs. development-specific commits, with conflict predictions for files Labrat has also modified
- Running `labrat sync` twice doesn't re-show already-evaluated commits — sync state persists in `UPSTREAM-SYNC.json`
- `labrat sync --apply <commit>` cherry-picks a non-conflicting upstream commit and verifies the build compiles and existing tests pass
- For a commit that conflicts, the apply path presents the conflict context to an LLM which produces an adapted patch that builds and passes tests
- A real GSD-2 upstream commit (bug fix or infrastructure improvement) is successfully identified, categorized, applied, and verified in Labrat's codebase

## Key Risks / Unknowns

- **Classification accuracy** — file-path heuristics must reliably separate infrastructure changes (packages/*, core modules) from development-specific changes (milestone/slice workflow, shipping features). Mixed commits (~30% of upstream history) require per-file analysis, not whole-commit classification.
- **Conflict surface on shared files** — 12 GSD extension files modified by both sides. `auto.ts` alone has 17 upstream commits and 500 lines of Labrat additions. Cherry-picks into these files will almost always conflict.
- **LLM adaptation quality** — adapting a 50-line patch in a 3275-line file with significant Labrat-specific additions requires substantial context. Quality is uncertain until proven with real patches.

## Proof Strategy

- **Classification accuracy** → retire in S01 by running classification against the real 59 upstream commits and verifying infrastructure commits (crash recovery, provider auth, TUI fixes) are correctly categorized, with contract tests against synthetic repos proving the heuristic rules
- **Conflict surface** → retire in S02 by predicting conflicts before apply and handling them gracefully (report, don't auto-resolve), proven with both synthetic conflict scenarios and real upstream commits
- **LLM adaptation quality** → retire in S03 by dispatching a real conflicting upstream commit through the LLM adaptation pipeline and verifying the adapted patch builds and passes tests

## Verification Classes

- Contract verification: synthetic git repos (mkdtempSync + git init) testing classification rules, sync state persistence, cherry-pick machinery, and conflict detection — following git-experiment.test.ts / steering.test.ts patterns
- Integration verification: real `git fetch upstream` against GSD-2 remote, real cherry-pick of an actual upstream commit, real `npm run build` + test suite after apply
- Operational verification: `labrat sync` CLI command works end-to-end from terminal, sync state survives across invocations
- UAT / human verification: none — categorization accuracy verifiable by inspection of the sync report against known upstream commit history

## Milestone Definition of Done

This milestone is complete only when all are true:

- All three slices completed with passing contract tests
- `labrat sync` produces a categorized report from real upstream data (not fixtures)
- `labrat sync --apply` successfully applies at least one real upstream commit
- An adapted upstream change passes `npm run build` and the full test suite
- Sync state persists across invocations — already-evaluated commits are tracked
- The sync module is completely decoupled from the experiment loop — `labrat auto` campaigns are unaffected
- Final integrated acceptance: a real GSD-2 bug fix or infrastructure improvement is identified, categorized, applied (with adaptation if conflicting), and verified in Labrat

## Requirement Coverage

- Covers: R026 (GSD-2 Upstream Feature Sync)
- Partially covers: none
- Leaves for later: none
- Orphan risks: none — R026 is the sole active requirement for M003

## Slices

- [x] **S01: Change Detection, Categorization & Sync Report** `risk:medium` `depends:[]`
  > After this: running `labrat sync` in the terminal fetches upstream changes and displays a categorized report showing infrastructure vs. development-specific commits, with conflict predictions and persistent sync state
- [x] **S02: Selective Apply & Build Verification** `risk:medium` `depends:[S01]`
  > After this: running `labrat sync --apply <commit>` cherry-picks a selected upstream commit, runs `npm run build` + test suite, and reports success or failure — conflicts are detected and reported but not auto-resolved
- [x] **S03: LLM-Assisted Conflict Adaptation** `risk:high` `depends:[S01,S02]`
  > After this: when `labrat sync --apply <commit>` encounters a conflict, it dispatches the conflict context to an LLM which produces an adapted patch, applies it, and verifies it builds and passes tests

## Boundary Map

### S01 → S02

Produces:
- `upstream-sync.ts` module following D039 extraction pattern with: `fetchUpstreamCommits()`, `categorizeCommit()`, `generateSyncReport()`, `readSyncState()`, `writeSyncState()` functions
- `UpstreamCommitInfo` type in types.ts: `{ hash, subject, author, date, filesChanged, category, conflictFiles }` where category is `'infrastructure' | 'development-specific' | 'mixed'`
- `SyncState` type in types.ts: `{ lastEvaluatedCommit, evaluatedCommits, appliedCommits, version }` persisted as `.gsd/UPSTREAM-SYNC.json` with atomic writes (D041/D045 pattern)
- `CommitCategory` type: `'infrastructure' | 'development-specific' | 'mixed'`
- `labrat sync` CLI subcommand (report-only mode) in cli.ts and commands.ts
- `getConflictFiles(commitHash)` function returning list of files that would conflict with Labrat's modifications
- Deterministic classification rules: file-path patterns as primary signal (packages/* → infrastructure, src/resources/extensions/gsd/* → per-file analysis using known Labrat-added files), commit message prefixes as secondary

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `applyUpstreamCommit(hash)` function: attempts `git cherry-pick --no-commit`, detects conflicts, runs build+tests on success
- `--apply <commit>` CLI flag on `labrat sync`
- `verifyAfterApply()` function: runs `npm run build` + `npx tsx <test-files>`, reports pass/fail
- Conflict context extraction: `getConflictContext(hash)` returning the conflicting hunks, Labrat's current file content, and the upstream patch — packaged for LLM consumption
- Updated `SyncState` with applied commit tracking
- Clear error reporting for conflicts: which files conflict, what the upstream change does, what Labrat's modifications are

Consumes:
- `UpstreamCommitInfo` with category and conflict predictions from S01
- `SyncState` read/write from S01
- `labrat sync` CLI subcommand from S01
