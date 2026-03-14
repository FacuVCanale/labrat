---
id: T02
parent: S07
milestone: M001
provides:
  - "`labrat report` CLI subcommand — reads campaign from disk, prints morning report to stdout, exits"
  - "`labrat start` CLI subcommand — parses research flags, creates GSD scaffold, auto-starts interactive mode"
  - "`/gsd report` interactive command — shows morning report via TUI notify"
  - "auto-start trigger in session_start hook via LABRAT_AUTO_START env var"
key_files:
  - "src/cli.ts"
  - "src/resources/extensions/gsd/commands.ts"
  - "src/resources/extensions/gsd/index.ts"
key_decisions:
  - "Dynamic imports used for morning-report/eval-runner/state/mlops in CLI to keep resource files out of tsc root scope"
  - "`labrat start --help` deferred from global --help handler so subcommand shows its own focused help"
  - "Fixed .ts import extensions in T01 files (morning-report.ts, eval-runner.ts, state.ts, files.ts, worktree.ts, preferences.ts) to .js — required because dynamic imports from cli.ts pull them into tsc scope"
  - "Auto-start uses setTimeout(100ms) to schedule startAuto after session_start returns, avoiding blocking the event handler"
patterns_established:
  - "Subcommand-specific --help: defer global help when first positional arg matches a subcommand with its own help"
  - "GSD scaffold creation pattern: idempotent file writes (only create if !existsSync) for roadmap, plan, and CAMPAIGN.json"
observability_surfaces:
  - "`labrat report` exit code 0 = success or no-campaign, exit code 1 = error"
  - "`labrat start` validation errors printed to stderr with usage hint"
  - "LABRAT_AUTO_START env var signals session_start to auto-trigger startAuto()"
duration: 25m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: CLI subcommands (`start`, `report`) and `/gsd report` interactive command

**Wired morning report into three entry points: `labrat report` (CLI), `labrat start` (scaffold + auto-launch), `/gsd report` (interactive), with full flag parsing, help text, and auto-start trigger.**

## What Happened

Added two CLI subcommands and one interactive command:

1. **`labrat report`** — finds active campaign dir via `findActiveCampaignDir()`, reads experiments/config/metrics, calls `generateMorningReport()`, writes to stdout, exits 0. Prints "No active campaign found." when no CAMPAIGN.json exists.

2. **`labrat start`** — parses research flags (`--target`, `--eval`, `--metric` as `name:dir:weight`, `--max-experiments`, `--budget-per-experiment`, `--research-question`). Validates required flags, creates GSD scaffold (M001-ROADMAP.md, S01-PLAN.md, CAMPAIGN.json) idempotently, sets `LABRAT_AUTO_START=1`, falls through to interactive mode.

3. **`/gsd report`** — interactive subcommand that reads campaign data and shows formatted report via `ctx.ui.notify()`. Added to completions array and usage string.

4. **Auto-start trigger** — `session_start` hook checks `LABRAT_AUTO_START`, deletes it, and schedules `startAuto()` via setTimeout to avoid blocking the hook.

Also fixed `.ts` import extensions in T01 files (morning-report.ts, eval-runner.ts, state.ts, files.ts, worktree.ts, preferences.ts) to `.js` — these caused tsc errors when dynamic imports from cli.ts pulled them into the compilation scope.

## Verification

- `npm run build` — exits 0, no type errors ✓
- `node dist/cli.js report` — prints "No active campaign found." and exits 0 ✓
- `node dist/cli.js report` (with campaign data at `/tmp/labrat-report-test`) — prints formatted report with all sections ✓
- `node dist/cli.js start --help` — shows start-specific help with target/eval/metric flags ✓
- `node dist/cli.js --help` — lists report and start subcommands ✓
- `node dist/cli.js report --bogus` — exits 0 gracefully ✓
- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — 46/46 tests pass ✓
- `labrat start` with valid flags creates CAMPAIGN.json parseable by `parseCampaignConfig()` ✓
- `labrat start` without required flags prints usage to stderr and exits 1 ✓

### Slice-level verification status (T02 is intermediate):
- `npx tsx .../morning-report.test.ts` — ✓ 46 passed
- `npm run build` — ✓ clean compile
- `python3 examples/karpathy-smoke/eval.py` — not yet (T03)
- `node dist/cli.js report 2>&1 | head -5` — ✓ "No active campaign found"
- `node dist/cli.js start --help 2>&1 | grep -q target` — ✓ PASS
- `node dist/cli.js report --bogus 2>&1` — ✓ exits 0 gracefully

## Diagnostics

- Run `labrat report` in any project directory to see campaign status at a glance
- `labrat start` prints validation errors to stderr with usage hint when flags are missing
- `labrat start --help` shows focused help for research campaign flags
- Auto-start flow: LABRAT_AUTO_START env var → session_start hook → startAuto()

## Deviations

- Fixed `.ts` → `.js` import extensions in T01 files — not in the task plan but required because cli.ts dynamic imports pull resource files into tsc's type-checking scope. Without this fix, `npm run build` fails.
- Added `--help` deferral logic for `labrat start --help` — the global `--help` handler was consuming the flag before the start subcommand handler could show its own help.

## Known Issues

- None

## Files Created/Modified

- `src/cli.ts` — added `report` and `start` subcommands, extended flag parsing for research flags, updated help text
- `src/resources/extensions/gsd/commands.ts` — added `/gsd report` subcommand with `handleReport()`, updated completions and usage string
- `src/resources/extensions/gsd/index.ts` — added auto-start trigger in `session_start` hook, imported `startAuto`
- `src/resources/extensions/gsd/morning-report.ts` — fixed `.ts` → `.js` import extensions
- `src/resources/extensions/gsd/eval-runner.ts` — fixed `.ts` → `.js` import extensions
- `src/resources/extensions/gsd/state.ts` — fixed `.ts` → `.js` import extensions
- `src/resources/extensions/gsd/files.ts` — fixed `.ts` → `.js` import extensions
- `src/resources/extensions/gsd/worktree.ts` — fixed `.ts` → `.js` import extensions
- `src/resources/extensions/gsd/preferences.ts` — fixed `.ts` → `.js` import extensions
