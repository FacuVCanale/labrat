---
id: T02
parent: S01
milestone: M003
provides:
  - labrat sync CLI subcommand (prints categorized upstream report, exits 0)
  - /gsd sync interactive command (displays report via ctx.ui.notify)
  - upstream-sync-integration.test.ts (74 assertions against real upstream)
key_files:
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts
key_decisions:
  - Conflict detection gracefully returns empty set when repos have unrelated histories (no merge-base); integration test adapts to this real-world condition rather than asserting false positives
  - Sync CLI persists ALL fetched commits as evaluated (not just filtered ones) — ensures --include-evaluated can re-show them while default behavior skips
patterns_established:
  - CLI sync handler follows report pattern: dynamic import → fetch → process → stdout → exit
  - Interactive sync handler follows report handler pattern: dynamic import → fetch → process → ctx.ui.notify
observability_surfaces:
  - labrat sync stdout output shows categorized upstream commits
  - labrat sync --help prints usage with flag documentation
  - .gsd/UPSTREAM-SYNC.json evaluatedCommits[] grows with each run
  - stderr warning on git fetch failure (continues with cached refs)
duration: 20m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Wire CLI subcommand and validate against real upstream

**Wired `labrat sync` CLI subcommand and `/gsd sync` interactive command, validated classification accuracy against 532 real upstream commits with 74 integration test assertions.**

## What Happened

1. Added `labrat sync` to `cli.ts` following the `labrat report` pattern: parses `--no-fetch` and `--include-evaluated` flags, dynamic-imports upstream-sync module, fetches+classifies+annotates commits, generates report to stdout, persists state, exits 0. Added `--help` handling and updated global help text.

2. Added `/gsd sync` to `commands.ts`: added `"sync"` to subcommands array for tab completion, added handler block that dynamic-imports upstream-sync, runs the full sync pipeline, and displays report via `ctx.ui.notify`. Updated unknown-command help message and command description.

3. Wrote `upstream-sync-integration.test.ts` with 74 assertions against the real GSD-2 upstream remote (532 commits): verified fetch returns structured commits, 467 infrastructure + 14 dev-specific + 51 mixed classification, packages-only commits are infrastructure, labrat-only commits are dev-specific, report contains expected section headers and summary, state persistence round-trips correctly, filtering excludes evaluated commits, second run returns empty, conflict detection degrades gracefully when no merge-base exists.

4. Verified end-to-end: `npm run build` compiles clean, `labrat sync --no-fetch` produces categorized output, running it twice shows "No new upstream commits to evaluate."

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 63 passed, 0 failed ✅
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` → 74 passed, 0 failed ✅
- `npm run build` → compiles clean ✅
- `node dist/cli.js sync --no-fetch` → prints categorized report (467 infra, 14 dev, 51 mixed) ✅
- `node dist/cli.js sync --no-fetch` (second run) → "No new upstream commits to evaluate." ✅
- `node dist/cli.js sync --help` → prints usage text ✅
- Malformed `.gsd/UPSTREAM-SYNC.json` → contract test proves graceful degradation (returns default state + stderr warning) ✅

## Diagnostics

- **CLI output:** `labrat sync` or `node dist/cli.js sync` → categorized upstream report
- **Help:** `labrat sync --help` → flag documentation
- **State inspection:** `cat .gsd/UPSTREAM-SYNC.json` → `evaluatedCommits[]`, `lastFetchedUpstream`, `version`
- **Repeat behavior:** Second run prints "No new upstream commits to evaluate." unless `--include-evaluated` is passed
- **Fetch skip:** `--no-fetch` uses cached refs (avoids network for debugging)
- **Failure modes:** Missing upstream remote → "Warning: git fetch upstream failed" on stderr + continues with cached refs; corrupt state file → returns fresh default state

## Deviations

- Conflict detection integration test: the real repo has unrelated histories (no merge-base between HEAD and upstream/main), so `getLabratModifiedFiles` correctly returns empty. The test adapts by verifying this graceful degradation instead of asserting false positives, and uses a synthetic scenario to confirm the function interface. Contract tests already prove full conflict detection logic.

## Known Issues

- None

## Files Created/Modified

- `src/cli.ts` — Added `labrat sync` subcommand with `--no-fetch`, `--include-evaluated`, `--help` flags; updated help text
- `src/resources/extensions/gsd/commands.ts` — Added `/gsd sync` handler, tab completion, help message
- `src/resources/extensions/gsd/tests/upstream-sync-integration.test.ts` — 74-assertion integration test against real upstream
- `.gsd/milestones/M003/slices/S01/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
