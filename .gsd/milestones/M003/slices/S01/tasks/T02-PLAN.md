---
estimated_steps: 4
estimated_files: 4
---

# T02: Wire CLI subcommand and validate against real upstream

**Slice:** S01 — Change Detection, Categorization & Sync Report
**Milestone:** M003

## Description

Wire `labrat sync` as a CLI subcommand (following the `labrat report` pattern in cli.ts) and `/gsd sync` as an interactive command. Then write an integration test that runs against the real GSD-2 upstream remote to validate classification accuracy on actual commits — verifying that known infrastructure fixes are correctly categorized and the report is usable.

## Steps

1. Add `labrat sync` subcommand in `cli.ts`:
   - Match the `labrat report` pattern: check `cliFlags.messages[0] === 'sync'`, dynamic import upstream-sync module, call `fetchUpstreamCommits()`, `categorizeCommit()` for each, `readSyncState()` / `writeSyncState()`, `generateSyncReport()`, write to stdout, exit.
   - Handle `--help` flag with usage text.
   - Handle `--no-fetch` flag to skip `git fetch upstream` (use cached remote refs).
   - Handle `--include-evaluated` flag to re-show already-evaluated commits.
   - Add `sync` to help text alongside `report` and `start`.

2. Add `/gsd sync` to `commands.ts`:
   - Add `"sync"` to the subcommands array for tab completion.
   - Add handler block following the `report` handler pattern: dynamic import, run sync, display report via `ctx.ui.notify`.
   - Add `sync` to the unknown-command help message.

3. Write `upstream-sync-integration.test.ts`:
   - Requires real upstream remote (skip with clear message if `git ls-remote upstream` fails).
   - Fetches real upstream commits.
   - Verifies at least one commit classified as `infrastructure` (e.g., "fix: stale lock detection" or "fix: retry logic for transient network" are infrastructure).
   - Verifies commits touching only `packages/*` are classified as infrastructure.
   - Verifies the report string contains expected section headers ("Infrastructure", "Development-Specific" or similar).
   - Verifies state persistence: run evaluation, write state, re-filter — previously evaluated commits are excluded.
   - Verifies conflict detection flags files that Labrat has also modified (auto.ts, commands.ts, etc.).

4. Update help text and verify end-to-end: `npm run build` clean, integration test passes, `labrat sync` produces output on stdout.

## Must-Haves

- [ ] `labrat sync` subcommand works from terminal (prints report, exits 0)
- [ ] `/gsd sync` interactive command works
- [ ] Running sync twice skips already-evaluated commits (state persists)
- [ ] Integration test verifies real upstream classification accuracy
- [ ] Help text updated in both CLI and interactive command

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` exits 0
- `npm run build` exits 0
- `node dist/cli.js sync 2>&1 | head -20` produces categorized output (or graceful error if no upstream configured)

## Inputs

- `src/resources/extensions/gsd/upstream-sync.ts` — T01's complete sync module
- `src/cli.ts` — existing CLI subcommand patterns (report, start)
- `src/resources/extensions/gsd/commands.ts` — existing interactive command patterns

## Expected Output

- `src/cli.ts` — extended with `labrat sync` subcommand
- `src/resources/extensions/gsd/commands.ts` — extended with `/gsd sync` handler
- `src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` — integration test against real upstream

## Observability Impact

- **New CLI surface:** `labrat sync` prints categorized upstream report to stdout; exit code 0 = success, exit code 1 = error. Stderr warnings on fetch failures.
- **New interactive surface:** `/gsd sync` displays the same report via `ctx.ui.notify`.
- **State file:** `.gsd/UPSTREAM-SYNC.json` updated after each sync run — `cat .gsd/UPSTREAM-SYNC.json` shows `evaluatedCommits[]` growing with each run.
- **Flags:** `--no-fetch` skips network access (useful for debugging cached state), `--include-evaluated` re-shows previously seen commits.
- **Failure visibility:** Missing upstream remote → clear error message on stderr + exit 0. Git fetch failure → stderr warning, continues with cached refs.
