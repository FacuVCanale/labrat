---
estimated_steps: 5
estimated_files: 4
---

# T02: CLI subcommands (`start`, `report`) and `/gsd report` interactive command

**Slice:** S07 — CLI, Morning Report & Smoke Test
**Milestone:** M001

## Description

Wire the morning report from T01 into three entry points: `labrat report` (pure CLI), `labrat start` (campaign bootstrap + interactive launch), and `/gsd report` (interactive subcommand). This task delivers R012 (CLI Commands) by adding the two new subcommands (`start`, `report`) alongside the existing `auto`/`stop`/`status` commands that already work via `/gsd`.

The `labrat start` command is the most complex piece — it must create a minimal GSD scaffold (milestone directory, roadmap, slice directory, slice plan, CAMPAIGN.json) so that `deriveState()` detects the campaign and enters the `experimenting` phase. After creating the scaffold, it falls through to interactive mode with `process.env.LABRAT_AUTO_START = '1'`, which the GSD extension's `session_start` hook picks up to auto-trigger `startAuto()`.

## Steps

1. Add `labrat report` subcommand in `src/cli.ts`:
   - After the existing `update` subcommand check, add `if (cliFlags.messages[0] === 'report')`
   - Import `findActiveCampaignDir`, `generateMorningReport` from morning-report module
   - Import `readAllExperiments`, `readBestMetrics` from eval-runner, `parseCampaignConfig` from state
   - Find active campaign dir; if none, print "No active campaign found." and exit 0
   - Read experiment log, campaign config, metrics ledger (read `.gsd/metrics.json` directly)
   - Compute `useColor` from `process.stdout.isTTY && !process.env.NO_COLOR`
   - Resolve dashboard URL: `createMLOpsClient(campaign.mlops)?.getDashboardUrl() ?? null` (returns base URL without run ID, which is fine for the report)
   - Call `generateMorningReport()`, write to stdout, `process.exit(0)`
   - Update help text to include `report` and `start` subcommands

2. Add `labrat start` subcommand in `src/cli.ts`:
   - Parse research-specific flags: `--target <path>` (required, repeatable), `--eval <command>` (required), `--metric <name:direction:weight>` (required, repeatable, format: `name:min|max:weight`), `--max-experiments <N>` (default 20), `--budget-per-experiment <USD>` (default 1.0), `--research-question <text>` (optional)
   - Validate required flags — print usage and exit 1 if missing
   - Create GSD scaffold:
     - `.gsd/milestones/M001/M001-ROADMAP.md` — minimal roadmap with one incomplete slice
     - `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — minimal plan with one task
     - `.gsd/milestones/M001/slices/S01/CAMPAIGN.json` — from parsed flags
   - Only create scaffold files if they don't already exist (idempotent)
   - Set `process.env.LABRAT_AUTO_START = '1'`
   - Do NOT call `process.exit(0)` — fall through to interactive mode

3. Add auto-start trigger in `src/resources/extensions/gsd/index.ts`:
   - In the `session_start` handler, after the existing header/remote-questions code, add:
   - Check `process.env.LABRAT_AUTO_START === '1'`; if so, delete the env var and schedule `startAuto(ctx as ExtensionCommandContext, pi, process.cwd(), false)` (the `fireStatusViaCommand` function already demonstrates this `ctx as ExtensionCommandContext` cast pattern)

4. Add `/gsd report` interactive subcommand in `src/resources/extensions/gsd/commands.ts`:
   - In the command handler, add `if (trimmed === "report")` check
   - Import morning-report module
   - Find campaign, read data, generate report, show via `ctx.ui.notify(reportText, "info")`
   - Add "report" to the subcommand completions array and the usage string

5. Verify: `npm run build` clean, `node dist/cli.js report` runs without crash, `node dist/cli.js start --help` mentions target/eval flags

## Must-Haves

- [ ] `labrat report` finds campaign from disk, prints formatted report to stdout, exits without TUI
- [ ] `labrat report` with no campaign prints "No active campaign found." and exits 0
- [ ] `labrat start` parses all research flags (`--target`, `--eval`, `--metric`, `--direction`, `--max-experiments`, `--budget-per-experiment`)
- [ ] `labrat start` creates CAMPAIGN.json with correct structure that `parseCampaignConfig()` can parse
- [ ] `labrat start` creates minimal GSD scaffold (roadmap + slice plan) so `deriveState()` enters experimenting phase
- [ ] `labrat start` falls through to interactive mode with auto-start trigger
- [ ] `/gsd report` available in interactive mode
- [ ] Help text updated with `start` and `report` subcommands

## Verification

- `npm run build` — exits 0, no type errors
- `node dist/cli.js report 2>&1 | head -5` — prints "No active campaign" or report (no crash)
- `node dist/cli.js start --help 2>&1 | grep -q target` — help includes research flags
- `node dist/cli.js --help 2>&1 | grep -q report` — help lists report subcommand
- Create a temp CAMPAIGN.json + EXPERIMENT-LOG.jsonl, run `labrat report` in that directory — verify formatted output

## Observability Impact

- Signals added/changed: `labrat report` exit code (0 = success/no-data, 1 = error); `LABRAT_AUTO_START` env var for session_start auto-trigger
- How a future agent inspects this: `labrat report` from any terminal in the project directory
- Failure state exposed: `labrat start` validation errors printed to stderr with usage hint

## Inputs

- `src/resources/extensions/gsd/morning-report.ts` — `generateMorningReport()`, `findActiveCampaignDir()` from T01
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments()`, `readBestMetrics()`
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()`
- `src/resources/extensions/gsd/mlops-integration.ts` — `createMLOpsClient()`
- `src/resources/extensions/gsd/auto.ts` — `startAuto()`
- `src/cli.ts` — existing subcommand pattern (`config`, `update`)
- `src/resources/extensions/gsd/commands.ts` — existing `/gsd` command routing
- `src/resources/extensions/gsd/index.ts` — `session_start` hook, `fireStatusViaCommand` cast pattern

## Expected Output

- `src/cli.ts` — modified: two new subcommands (`start`, `report`), extended flag parsing, updated help text
- `src/resources/extensions/gsd/commands.ts` — modified: `/gsd report` subcommand added
- `src/resources/extensions/gsd/index.ts` — modified: auto-start trigger in `session_start` hook
