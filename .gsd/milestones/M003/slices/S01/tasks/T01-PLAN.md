---
estimated_steps: 5
estimated_files: 3
---

# T01: Build upstream-sync module with classification engine and contract tests

**Slice:** S01 — Change Detection, Categorization & Sync Report
**Milestone:** M003

## Description

Create the core `upstream-sync.ts` module following the D039 extraction pattern — a standalone module with pure functions for fetching upstream commits, classifying them by file-path heuristics (D053), detecting conflicts with Labrat's modifications, persisting sync state atomically (D054), and generating a formatted terminal report. Fully decoupled from the experiment loop (D055). Contract tests use synthetic git repos (mkdtempSync + git init) to prove classification accuracy, state persistence, and report generation.

## Steps

1. Add types to `types.ts`: `CommitCategory` union type (`'infrastructure' | 'development-specific' | 'mixed'`), `UpstreamCommitInfo` interface (`hash, subject, author, date, filesChanged, category, conflictFiles`), `SyncState` interface (`lastFetchedUpstream, evaluatedCommits, appliedCommits, version`).

2. Create `upstream-sync.ts` with:
   - File-path classification rules: `packages/*` → infrastructure, `src/resources/extensions/gsd/tests/*` → development-specific (test files for Labrat features), files in a known Labrat-added set (agenda.ts, steering.ts, simplicity-scorer.ts, eval-runner.ts, mlops-integration.ts, morning-report.ts, prompts/*) → development-specific, shared files (auto.ts, commands.ts, state.ts, git-service.ts, types.ts, cli.ts, index.ts) → needs per-file analysis. Commit message prefixes as secondary signal (`fix:`, `feat:` with scope like `voice`, `provider`).
   - `fetchUpstreamCommits(basePath, sinceCommit?)`: runs `git log --format=... --name-only upstream/main` to get commits with changed files. Returns `UpstreamCommitInfo[]`.
   - `categorizeCommit(commit)`: applies file-path rules, returns category. For mixed commits, per-file analysis determines if infrastructure-relevant files are present.
   - `getConflictFiles(basePath, commitFiles)`: compares commit's changed files against the set of files Labrat has modified (computed via `git diff --name-only <fork-point>..HEAD`).
   - `getLabratModifiedFiles(basePath)`: cached helper returning files Labrat has changed since fork point.
   - `readSyncState(basePath)` / `writeSyncState(basePath, state)`: atomic JSON I/O at `.gsd/UPSTREAM-SYNC.json` using write-to-temp-then-rename (D045 pattern).
   - `filterNewCommits(commits, state)`: removes already-evaluated commits.
   - `generateSyncReport(commits, options)`: pure string formatter producing categorized terminal output with infrastructure/mixed/dev-specific sections, conflict warnings, and summary counts. Respects NO_COLOR.

3. Write `upstream-sync.test.ts` with synthetic git repos testing:
   - Classification: infrastructure-only commit (packages/* files only) → `infrastructure`
   - Classification: Labrat-added file only (steering.ts) → `development-specific`
   - Classification: mixed commit (auto.ts + packages/foo) → `mixed`
   - Classification: commit touching only unknown files → `infrastructure` (conservative default)
   - State persistence: write → read round-trip preserves all fields
   - State persistence: malformed JSON degrades to fresh state with stderr warning
   - State persistence: missing file returns default empty state
   - Conflict detection: commit touching file Labrat also modified → conflict reported
   - Conflict detection: commit touching file Labrat hasn't modified → no conflict
   - Report formatting: infrastructure commits appear in infrastructure section
   - Report formatting: conflict files listed with warning markers
   - Report formatting: empty commit list produces "no new upstream commits" message
   - Idempotent evaluation: filtering with state removes already-seen commits

4. Ensure `npm run build` compiles clean with the new module and type additions.

5. Run the contract test suite and verify all tests pass.

## Must-Haves

- [ ] `UpstreamCommitInfo`, `SyncState`, `CommitCategory` types in types.ts
- [ ] `upstream-sync.ts` has zero imports from auto.ts, eval-runner.ts, or campaign lifecycle (D055)
- [ ] File-path-primary classification with known Labrat-added file exclusion (D053)
- [ ] Atomic state writes using temp+rename pattern (D054/D045)
- [ ] Contract tests cover infrastructure, dev-specific, mixed classification, state persistence, conflict detection
- [ ] `generateSyncReport()` is a pure function (no I/O) matching morning-report.ts pattern (D036)
- [ ] Build compiles clean

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` exits 0 with all assertions passing
- `npm run build` exits 0
- `grep -c 'import.*auto\|import.*eval-runner\|import.*campaign' src/resources/extensions/gsd/upstream-sync.ts` returns 0

## Inputs

- `src/resources/extensions/gsd/types.ts` — existing type definitions to extend
- `src/resources/extensions/gsd/git-service.ts` — `runGit` helper for git operations
- `src/resources/extensions/gsd/steering.ts` — atomic write pattern reference (D045)
- `src/resources/extensions/gsd/tests/git-experiment.test.ts` — synthetic repo test pattern reference

## Expected Output

- `src/resources/extensions/gsd/upstream-sync.ts` — complete sync module with all functions
- `src/resources/extensions/gsd/types.ts` — extended with sync-related types
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — contract test suite (target: 30+ assertions)

## Observability Impact

- **New persisted state:** `.gsd/UPSTREAM-SYNC.json` — inspect with `cat .gsd/UPSTREAM-SYNC.json` to see last-fetched commit, evaluated commit hashes, and applied commit hashes
- **Failure signals:** `readSyncState()` emits `[upstream-sync]` stderr warning on malformed JSON and degrades to fresh default state (never throws)
- **Diagnostic surface:** `generateSyncReport()` output includes summary counts (infrastructure/mixed/dev-specific) and conflict warning markers (`⚠`) for any file overlapping with Labrat modifications
- **Future agent inspection:** An agent can read `UPSTREAM-SYNC.json` to determine sync freshness, check `evaluatedCommits` array length for progress, and compare `lastFetchedUpstream` against `git rev-parse upstream/main` to detect staleness
