---
id: S02
parent: M003
milestone: M003
provides:
  - "applyUpstreamCommit(basePath, hash) — cherry-pick with conflict detection, verify, revert-on-failure, state tracking"
  - "verifyAfterApply(basePath) — build+test verification with timeouts (120s/300s) and structured results"
  - "getConflictContext(basePath, hash) — merge marker extraction, Labrat version, upstream patch per conflicting file"
  - "ApplyResult, VerifyResult, ConflictContext, ConflictFileInfo types in types.ts"
  - "`--apply <hash>` CLI flag on `labrat sync`"
  - "Interactive `/gsd sync --apply <hash>` command path"
requires:
  - slice: S01
    provides: "UpstreamCommitInfo, SyncState types, readSyncState/writeSyncState, runGit, fetchUpstreamCommits, labrat sync CLI subcommand"
affects:
  - S03
key_files:
  - src/resources/extensions/gsd/upstream-sync.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/tests/upstream-sync.test.ts
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
key_decisions:
  - D059 — git commit messages via stdin (-F -) to avoid shell escaping issues with parentheses
patterns_established:
  - "Cherry-pick flow: --no-commit → commit via -F - → verify → revert-on-failure → state update"
  - "Conflict context extraction before abort (merge markers only exist while conflict is active)"
  - "Every exit path in applyUpstreamCommit either aborts cherry-pick or resets to clean state"
  - "Apply handler early-exits before sync report path, matching existing subcommand flag patterns"
  - "Interactive command accepts arguments via rawCommand string parsing"
observability_surfaces:
  - "readSyncState(basePath).appliedCommits — list of successfully applied hashes"
  - "ApplyResult.conflictContext.conflictingFiles[].withMarkers — per-file conflict markers"
  - "ApplyResult.error — structured error message on any failure path"
  - "ApplyResult.verifyResult — build/test pass status with output"
  - "`labrat sync --apply <hash>` prints structured result to stdout (success) or stderr (conflict/error) with exit code 0/1"
  - "cat .gsd/UPSTREAM-SYNC.json — appliedCommits array after successful apply"
drill_down_paths:
  - .gsd/milestones/M003/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S02/tasks/T02-SUMMARY.md
duration: 33m
verification_result: passed
completed_at: 2026-03-14
---

# S02: Selective Apply & Build Verification

**Cherry-pick upstream commits with conflict detection, build+test verification, automatic revert-on-failure, and structured conflict context extraction for LLM adaptation.**

## What Happened

Implemented the selective apply pipeline in two tasks:

**T01 (25m):** Added five types (`ApplyResult`, `VerifyResult`, `ConflictContext`, `ConflictFileInfo`) to types.ts. Implemented three functions in upstream-sync.ts: `applyUpstreamCommit` (validates not already applied → checks clean tree → cherry-pick --no-commit → on clean: commit via -F - stdin → verify build+test → revert on failure → update state; on conflict: extract context BEFORE abort → return structured conflict), `verifyAfterApply` (execSync build 120s + test 300s, 10MB maxBuffer, missing scripts treated as pass), and `getConflictContext` (reads unmerged files, extracts merge markers from working tree, Labrat's HEAD version, upstream patch per file). Fixed pre-existing `require('node:fs')` ESM incompatibility in `writeSyncState`. Added 50 contract test assertions across 7 scenarios.

**T02 (8m):** Added `applyHash?: string` to CliFlags, `--apply <hash>` flag parsing, help text update. Apply handler branch in sync CLI block early-exits before the report path — imports `applyUpstreamCommit`, prints structured output (✓ success / ✗ conflict with file list / ✗ error), exits with code 0/1. Extended interactive `/gsd sync` handler to parse `--apply <hash>` from rawCommand string and surface results via `ctx.ui.notify`.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → **113 passed, 0 failed** (63 S01 + 50 S02)
- `npm run build` → compiles clean
- `node dist/cli.js sync --help` → shows `--apply <hash>` in options list
- Contract tests cover: clean cherry-pick, conflict with context extraction, already-applied rejection, verify with no package.json, verify with no scripts, state persistence on disk, getConflictContext structure, dirty working tree guard
- All failure paths produce structured `ApplyResult.error`; conflict paths produce `conflictContext.conflictingFiles[].withMarkers` with `<<<<<<<` markers

## Requirements Advanced

- R026 (GSD-2 Upstream Feature Sync) — selective apply pipeline proven: cherry-pick mechanics, conflict detection with context extraction, build+test verification, state tracking. Remaining: S03 (LLM-assisted conflict adaptation).

## Requirements Validated

- None newly validated — R026 requires S03 completion for full validation.

## New Requirements Surfaced

- None

## Requirements Invalidated or Re-scoped

- None

## Deviations

- Fixed pre-existing `require('node:fs')` ESM incompatibility in `writeSyncState` — bugfix, not plan deviation.
- D059: Used `git commit -F -` with stdin pipe instead of `-m` flag — discovered during testing that parentheses in commit messages break shell parsing.

## Known Limitations

- Conflict path detects and reports conflicts but does not resolve them — deferred to S03 (LLM-assisted conflict adaptation).
- `verifyAfterApply` is tested via error-handling paths in contract tests, not actual `npm run build` execution — real build verification happens at operational level.
- Interactive `/gsd sync --apply` parses arguments from raw command string — fragile if command format changes.

## Follow-ups

- S03: LLM-assisted conflict adaptation — consumes `ConflictContext` produced by `getConflictContext` to generate adapted patches for conflicting commits.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — added `ApplyResult`, `VerifyResult`, `ConflictContext`, `ConflictFileInfo` types
- `src/resources/extensions/gsd/upstream-sync.ts` — added `applyUpstreamCommit`, `verifyAfterApply`, `getConflictContext` exports; fixed `require()` ESM bug
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — added 7 S02 test scenarios with 50 assertions
- `src/cli.ts` — added `applyHash` to CliFlags, `--apply` flag parsing, help text, apply handler branch
- `src/resources/extensions/gsd/commands.ts` — extended `handleSync` to parse `--apply <hash>` from rawCommand

## Forward Intelligence

### What the next slice should know
- `getConflictContext` returns per-file `ConflictFileInfo` with `withMarkers` (raw merge markers from working tree), `labratVersion` (HEAD content), and `upstreamPatch` (diff between commit and its parent). All three fields are strings ready for LLM prompt assembly.
- Conflict context is extracted BEFORE `cherry-pick --abort` — merge markers only exist while the conflict is active. S03 must not change this ordering.
- `applyUpstreamCommit` returns `ApplyResult.conflicted: true` with full `conflictContext` on conflict path — S03 should check this flag and dispatch to LLM adaptation.

### What's fragile
- Interactive command argument parsing splits on whitespace and searches for `--apply` index — could break with quoted arguments or extra whitespace.
- `verifyAfterApply` uses `execSync` with 120s/300s timeouts — real projects with slow builds may exceed these.

### Authoritative diagnostics
- `readSyncState(basePath).appliedCommits` — ground truth for what's been applied
- `ApplyResult` fields (`success`, `conflicted`, `conflictContext`, `verifyResult`, `error`) — complete outcome for any apply attempt
- `cat .gsd/UPSTREAM-SYNC.json` — raw state file on disk

### What assumptions changed
- Assumed `-m` flag safe for commit messages — parentheses break shell parsing, switched to `-F -` stdin (D059)
