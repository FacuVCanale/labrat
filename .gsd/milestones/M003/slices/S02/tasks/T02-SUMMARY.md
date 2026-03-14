---
id: T02
parent: S02
milestone: M003
provides:
  - "`--apply <hash>` CLI flag on `labrat sync` — calls applyUpstreamCommit and prints structured result"
  - "Interactive `/gsd sync --apply <hash>` command path — same apply logic via ctx.ui.notify"
key_files:
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
key_decisions: []
patterns_established:
  - "Apply handler branch early-exits before the sync report path, matching existing subcommand flag patterns (--no-fetch, --include-evaluated)"
  - "Interactive command accepts arguments via rawCommand string parsing — splits on whitespace, finds --apply index"
observability_surfaces:
  - "`labrat sync --apply <hash>` prints structured result to stdout (success) or stderr (conflict/error) with exit code 0/1"
  - "`/gsd sync --apply <hash>` surfaces result via ctx.ui.notify — info for success, warning for conflict/error"
  - "Conflict output lists per-file paths; verify failure output shows build/test pass status"
duration: 8m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Wire --apply flag into CLI and interactive command

**Wired `--apply <hash>` into `labrat sync` CLI and `/gsd sync` interactive command with structured success/conflict/error output.**

## What Happened

Added `applyHash?: string` to the `CliFlags` interface and `--apply <hash>` parsing in `parseCliArgs()` following the same pattern as `--model <value>`. Updated sync help text to document the new flag. Added an apply handler branch in the sync CLI block that early-exits before the report path — imports `applyUpstreamCommit`, calls it, prints structured output (✓ success with build/test status, ✗ conflict with file list, ✗ error with message), and exits with code 0 or 1.

Extended the interactive `/gsd sync` handler in commands.ts to accept arguments by changing the match from exact `"sync"` to `trimmed.startsWith("sync")` and parsing `--apply <hash>` from the command string. The apply result is surfaced via `ctx.ui.notify()` with appropriate severity levels.

## Verification

- `npm run build` → compiles clean ✓
- `node dist/cli.js sync --help` → shows `--apply <hash>` in options list ✓
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 113 passed, 0 failed ✓

### Slice-level verification status (T02 is final task):
- ✅ `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — 113 assertions pass (all S01 63 + S02 50)
- ✅ `npm run build` — compiles clean
- ✅ `node dist/cli.js sync --help` — shows `--apply <hash>` in help text
- ✅ Contract tests verify `ApplyResult.error` on failure paths and `ApplyResult.conflictContext.conflictingFiles` structured data on conflict paths

## Diagnostics

- `labrat sync --apply <hash>` — prints structured result to stdout/stderr with exit 0/1
- `/gsd sync --apply <hash>` — surfaces result via interactive notify
- `cat .gsd/UPSTREAM-SYNC.json` — shows `appliedCommits` array after successful apply (written by `applyUpstreamCommit`)
- `ApplyResult` fields fully surfaced: `success`, `conflicted`, `conflictContext` (hash, subject, per-file data), `verifyResult` (build/test pass status), `error`

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/cli.ts` — Added `applyHash` to CliFlags, `--apply` flag parsing, help text, and apply handler branch in sync block
- `src/resources/extensions/gsd/commands.ts` — Extended `handleSync` to accept rawCommand arg, parse `--apply <hash>`, and call `applyUpstreamCommit` with notify output
- `.gsd/milestones/M003/slices/S02/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
