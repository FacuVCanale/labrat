# S01: Change Detection, Categorization & Sync Report

**Goal:** `upstream-sync.ts` module fetches upstream commits since fork point, classifies each as infrastructure/development-specific/mixed, predicts file conflicts, persists sync state, and generates a structured terminal report — wired as `labrat sync` CLI subcommand.
**Demo:** Running `labrat sync` in the terminal fetches GSD-2 upstream changes and displays a categorized report. Running it again skips already-evaluated commits.

## Must-Haves

- `fetchUpstreamCommits()` returns commits between fork point and upstream/main with files changed per commit
- `categorizeCommit()` classifies each commit as `infrastructure`, `development-specific`, or `mixed` using file-path-primary rules (D053)
- `getConflictFiles()` returns list of files that would conflict with Labrat's modifications for a given commit
- `generateSyncReport()` produces a formatted terminal string showing categorized commits with conflict predictions
- `readSyncState()` / `writeSyncState()` persist evaluated and applied commits in `.gsd/UPSTREAM-SYNC.json` with atomic writes (D054)
- Running sync twice doesn't re-show already-evaluated commits
- Types (`UpstreamCommitInfo`, `SyncState`, `CommitCategory`) exported from types.ts
- `labrat sync` CLI subcommand (report-only mode) works from terminal
- Module has zero imports from auto.ts, eval-runner.ts, or campaign lifecycle (D055)

## Proof Level

- This slice proves: contract + integration
- Real runtime required: yes (real `git fetch upstream`, real upstream remote)
- Human/UAT required: no

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — contract tests pass (classification rules, state persistence, conflict detection, report generation against synthetic git repos)
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` — integration test passes (real upstream fetch, real commit classification, report generation)
- `npm run build` compiles clean
- Malformed `.gsd/UPSTREAM-SYNC.json` degrades gracefully: `echo '{bad' > .gsd/UPSTREAM-SYNC.json && npx tsx -e "import {readSyncState} from './src/resources/extensions/gsd/upstream-sync.ts'; console.log(JSON.stringify(readSyncState('.')))"` returns default empty state and emits stderr warning

## Observability / Diagnostics

- Runtime signals: stderr warnings for fetch failures, unrecognized file patterns
- Inspection surfaces: `cat .gsd/UPSTREAM-SYNC.json` for sync state, `labrat sync` for report
- Failure visibility: fetch errors surface in report with clear message, malformed state file degrades to fresh state
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `git-service.ts` (`runGit`), `types.ts` (type additions)
- New wiring introduced in this slice: `labrat sync` subcommand in cli.ts, `/gsd sync` in commands.ts
- What remains before the milestone is truly usable end-to-end: S02 (selective apply), S03 (LLM conflict adaptation)

## Tasks

- [x] **T01: Build upstream-sync module with classification engine and contract tests** `est:2h`
  - Why: Core module delivering all sync logic — classification, state persistence, conflict detection, report formatting — with contract tests proving correctness against synthetic repos
  - Files: `src/resources/extensions/gsd/upstream-sync.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/upstream-sync.test.ts`
  - Do: Add `UpstreamCommitInfo`, `SyncState`, `CommitCategory` types to types.ts. Create `upstream-sync.ts` following D039 extraction pattern (pure functions, no auto.ts imports per D055) with: `fetchUpstreamCommits()` using `runGit` to get commit log with `--name-only`, `categorizeCommit()` with file-path-primary classification (D053), `getConflictFiles()` comparing commit files against Labrat-modified files, `readSyncState()`/`writeSyncState()` with atomic writes (D054 pattern from steering.ts), `generateSyncReport()` pure formatter. Write comprehensive contract tests using synthetic git repos (mkdtempSync + git init pattern from git-experiment.test.ts) covering: classification of infrastructure-only, dev-specific-only, and mixed commits; state persistence and idempotent re-evaluation; conflict prediction accuracy; report formatting; malformed state degradation.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` passes, `npm run build` compiles clean
  - Done when: All classification rules proven by contract tests against synthetic repos, state persistence survives read/write cycles, conflict detection identifies overlapping files

- [x] **T02: Wire CLI subcommand and validate against real upstream** `est:1h`
  - Why: Makes the module usable — `labrat sync` subcommand in cli.ts + `/gsd sync` interactive command, then validates classification against real GSD-2 upstream commits
  - Files: `src/cli.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts`
  - Do: Add `labrat sync` subcommand in cli.ts (following `labrat report` pattern — dynamic import, fetch, format, print, exit). Add `/gsd sync` to commands.ts subcommand list and handler. Write integration test that runs against the real upstream remote: fetches real commits, verifies known infrastructure commits (crash recovery, provider fixes) are correctly classified, verifies known development commits are filtered, verifies report contains expected sections and known commit subjects. Add `sync` to help text in both CLI and interactive command list.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` passes, `labrat sync` produces a categorized report on stdout
  - Done when: `labrat sync` displays categorized upstream commits, running it twice shows "no new commits" or skips already-evaluated ones, infrastructure commits (fix: stale lock, fix: retry logic) correctly classified

## Files Likely Touched

- `src/resources/extensions/gsd/upstream-sync.ts` (new)
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` (new)
- `src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` (new)
- `src/cli.ts`
- `src/resources/extensions/gsd/commands.ts`
