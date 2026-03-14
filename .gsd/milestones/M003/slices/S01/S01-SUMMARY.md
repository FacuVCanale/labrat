---
id: S01
parent: M003
milestone: M003
provides:
  - upstream-sync.ts module with classification engine, state persistence, conflict detection, report generation
  - CommitCategory, UpstreamCommitInfo, SyncState types in types.ts
  - labrat sync CLI subcommand (report-only mode) with --no-fetch and --include-evaluated flags
  - /gsd sync interactive command
  - fetchUpstreamCommits(), categorizeCommit(), getConflictFiles(), generateSyncReport(), readSyncState(), writeSyncState(), filterNewCommits() exported functions
  - Contract test suite (63 assertions) and integration test suite (74 assertions)
requires:
  - slice: none
    provides: first slice in M003
affects:
  - S02 (consumes UpstreamCommitInfo, SyncState, CLI subcommand, classification output)
  - S03 (consumes all S01 + S02 outputs)
key_files:
  - src/resources/extensions/gsd/upstream-sync.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/upstream-sync.test.ts
  - src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
key_decisions:
  - D053 refined: unknown files → infrastructure (conservative default — safer to surface than hide)
  - D054 implemented: atomic temp+rename writes for UPSTREAM-SYNC.json
  - D055 verified: zero imports from auto.ts, eval-runner.ts, or campaign lifecycle
  - D056: Conflict detection returns empty set on unrelated histories (no merge-base) — graceful degradation
  - D057: Sync CLI persists ALL fetched commits as evaluated, not just filtered — enables --include-evaluated re-show
patterns_established:
  - upstream-sync.ts follows D039 extraction pattern (pure functions, zero lifecycle imports)
  - Atomic state I/O via write-to-temp-then-rename (D045) at .gsd/UPSTREAM-SYNC.json
  - generateSyncReport() is pure (no I/O) following morning-report.ts pattern (D036)
  - Synthetic git repo test pattern with setupRepoWithUpstream() for multi-remote scenarios
  - CLI sync handler follows report pattern: dynamic import → fetch → process → stdout → exit
observability_surfaces:
  - cat .gsd/UPSTREAM-SYNC.json — sync state (lastFetchedUpstream, evaluatedCommits, appliedCommits)
  - labrat sync stdout — categorized upstream report with ⚠ conflict markers
  - labrat sync --help — flag documentation
  - stderr [upstream-sync] warnings on malformed/corrupt state JSON or fetch failures
drill_down_paths:
  - .gsd/milestones/M003/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S01/tasks/T02-SUMMARY.md
duration: 40m
verification_result: passed
completed_at: 2026-03-14
---

# S01: Change Detection, Categorization & Sync Report

**Upstream sync module fetches 532 real GSD-2 commits, classifies them as infrastructure/development-specific/mixed via file-path rules, predicts conflicts, persists state atomically, and generates categorized terminal report — wired as `labrat sync` CLI subcommand and `/gsd sync` interactive command, proven by 137 test assertions.**

## What Happened

Created `upstream-sync.ts` as a standalone module (D039/D055 — zero auto.ts imports) with six core functions:

1. **Classification engine** (`categorizeCommit`): File-path-primary rules (D053) — `packages/*` → infrastructure, known Labrat-added files (steering.ts, eval-runner.ts, etc.) → development-specific, shared files (auto.ts, types.ts) → infrastructure when alone, `mixed` when combined with dev-specific files. Conservative default: unknown files treated as infrastructure.

2. **Upstream fetch** (`fetchUpstreamCommits`): Runs `git log --format --name-only upstream/main` with ‖ delimiter, parses into structured `UpstreamCommitInfo[]` with per-commit file lists.

3. **Conflict detection** (`getConflictFiles`): Compares commit files against `getLabratModifiedFiles()` (cached, computed via `git diff --name-only <fork-point>..HEAD`). Gracefully returns empty set when repos have unrelated histories.

4. **State persistence** (`readSyncState`/`writeSyncState`): Atomic temp+rename writes (D045) at `.gsd/UPSTREAM-SYNC.json`. Malformed JSON degrades to fresh state with stderr warning.

5. **Filtering** (`filterNewCommits`): Removes already-evaluated commits by hash. All fetched commits persisted as evaluated — enables `--include-evaluated` to re-show them.

6. **Report generation** (`generateSyncReport`): Pure function (D036) producing categorized terminal output with infrastructure/mixed/dev-specific sections, `⚠ conflicts:` markers, and summary counts. Respects NO_COLOR.

Wired as `labrat sync` CLI subcommand (following `labrat report` pattern) with `--no-fetch` and `--include-evaluated` flags, and `/gsd sync` interactive command with tab completion.

Integration testing against the real GSD-2 upstream validated classification accuracy: 467 infrastructure, 14 development-specific, 51 mixed across 532 commits. Running sync twice correctly shows "No new upstream commits to evaluate."

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 63 passed, 0 failed ✅
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` → 74 passed, 0 failed ✅
- `npm run build` → compiles clean ✅
- `node dist/cli.js sync --no-fetch` → prints categorized report ✅
- `node dist/cli.js sync --no-fetch` (second run) → "No new upstream commits to evaluate." ✅
- `node dist/cli.js sync --help` → prints usage text ✅
- Malformed `.gsd/UPSTREAM-SYNC.json` → contract test proves graceful degradation ✅
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" upstream-sync.ts` → 0 (D055 confirmed) ✅

## Requirements Advanced

- R026 (GSD-2 Upstream Feature Sync) — S01 delivers the detection, categorization, and reporting layer. Upstream changes are fetchable, classifiable, and displayable. Sync state persists across invocations. Remaining: selective apply (S02) and LLM conflict adaptation (S03).

## Requirements Validated

- None fully validated — R026 requires all three slices for full validation.

## New Requirements Surfaced

- None

## Requirements Invalidated or Re-scoped

- None

## Deviations

- Conflict detection integration test: the real repo has unrelated histories (no merge-base between HEAD and upstream/main), so `getLabratModifiedFiles` correctly returns empty. Test adapts by verifying graceful degradation and using a synthetic scenario for the function interface. Contract tests already prove full conflict detection logic.
- The `npx tsx -e` malformed state degradation test from the slice plan hits a monorepo module resolution error. The behavior is fully proven by contract tests (test case: writes `{bad json!!!` → readSyncState returns default state + stderr warning).

## Known Limitations

- Conflict prediction depends on merge-base availability — repos with unrelated histories get empty conflict sets (graceful but uninformative). S02 will need cherry-pick-based conflict detection for accuracy.
- Classification rules are file-path heuristic — no semantic analysis of commit content. ~30% of upstream commits classified as `mixed` require human judgment on which files are relevant.
- `--include-evaluated` flag re-shows all commits but doesn't distinguish applied from merely evaluated. S02 adds applied commit tracking.

## Follow-ups

- S02 will consume `UpstreamCommitInfo` and `SyncState` for selective apply
- S02 may need to refine conflict detection to use actual `git cherry-pick --no-commit` dry-run instead of file-overlap heuristic

## Files Created/Modified

- `src/resources/extensions/gsd/upstream-sync.ts` — new module with all sync functions
- `src/resources/extensions/gsd/types.ts` — added CommitCategory, UpstreamCommitInfo, SyncState types
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — 63-assertion contract test suite
- `src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` — 74-assertion integration test suite
- `src/cli.ts` — added `labrat sync` subcommand with flags and help
- `src/resources/extensions/gsd/commands.ts` — added `/gsd sync` handler and tab completion

## Forward Intelligence

### What the next slice should know
- `fetchUpstreamCommits()` returns all commits between fork point and upstream/main — already structured with `UpstreamCommitInfo.filesChanged` for per-commit analysis
- `readSyncState()`/`writeSyncState()` are the only way to interact with `.gsd/UPSTREAM-SYNC.json` — use them, don't read the file directly
- `SyncState.appliedCommits` exists but is never populated by S01 — S02 must write to it after successful cherry-pick
- The CLI handler in `cli.ts` will need a `--apply <hash>` flag added — the switch/case structure is straightforward

### What's fragile
- `getLabratModifiedFiles()` returns empty when no merge-base exists with upstream — S02's conflict detection should use `git cherry-pick --no-commit` dry-run for real accuracy
- Classification of the 12 shared GSD extension files relies on a hardcoded `LABRAT_ADDED_FILES` set — new Labrat-specific files need to be added manually

### Authoritative diagnostics
- `cat .gsd/UPSTREAM-SYNC.json` — ground truth for sync state (evaluated/applied commits)
- `labrat sync --no-fetch --include-evaluated` — re-shows all commits without network access
- Contract test output (63 assertions) — proves all classification rules, state persistence, and report formatting

### What assumptions changed
- Original assumption: conflict detection would use merge-base between HEAD and upstream — actual: repos have unrelated histories, so file-overlap heuristic is used with graceful degradation
- Original assumption: ~59 upstream commits — actual: 532 commits (upstream has continued evolving)
