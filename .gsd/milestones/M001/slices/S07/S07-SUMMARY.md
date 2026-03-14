---
id: S07
parent: M001
milestone: M001
provides:
  - "`generateMorningReport()` pure formatter — campaign data in, formatted terminal string out with 7 conditional sections"
  - "`findActiveCampaignDir()` scanner — locates CAMPAIGN.json in milestone/slice tree"
  - "`labrat report` CLI subcommand — reads campaign from disk, prints morning report, exits"
  - "`labrat start` CLI subcommand — parses research flags, creates GSD scaffold, auto-starts interactive mode"
  - "`/gsd report` interactive command — shows morning report via TUI notify"
  - "Auto-start trigger via LABRAT_AUTO_START env var in session_start hook"
  - "Karpathy smoke test harness — deterministic eval pipeline for UAT"
requires:
  - slice: S04
    provides: "Research prompt templates and fresh context builder"
  - slice: S05
    provides: "ExperimentLog JSONL, crash recovery, budget/timeout supervision"
  - slice: S06
    provides: "MLOps REST clients (W&B/MLFlow), dashboard URL resolver"
affects: []
key_files:
  - src/resources/extensions/gsd/morning-report.ts
  - src/resources/extensions/gsd/tests/morning-report.test.ts
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/index.ts
  - examples/karpathy-smoke/train.py
  - examples/karpathy-smoke/eval.py
  - examples/karpathy-smoke/verify.sh
  - examples/karpathy-smoke/README.md
key_decisions:
  - "D034: Auto-start via LABRAT_AUTO_START env var checked by session_start hook"
  - "D035: labrat start creates minimal M001/S01 scaffold — just enough for deriveState()"
  - "D036: Morning report is a pure function — data in, string out, no I/O"
  - "D037: Read .gsd/metrics.json directly for cost data instead of exporting loadLedger()"
patterns_established:
  - "Pure formatter pattern: MorningReportInput interface in, string out, useColor flag for ANSI control"
  - "Subcommand-specific --help: defer global help when first positional arg matches a subcommand"
  - "GSD scaffold creation: idempotent file writes (only create if !existsSync)"
  - "Eval wrapper pattern: run training script, import metrics function, output single JSON line to stdout"
observability_surfaces:
  - "`labrat report` is the primary diagnostic — shows campaign state at a glance"
  - "`labrat report` exit code 0 = success or no-campaign, exit code 1 = error"
  - "verify.sh validates eval pipeline end-to-end with determinism check"
drill_down_paths:
  - .gsd/milestones/M001/slices/S07/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S07/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S07/tasks/T03-SUMMARY.md
duration: 50m
verification_result: passed
completed_at: 2026-03-14
---

# S07: CLI, Morning Report & Smoke Test

**Final assembly: `labrat report` shows formatted campaign summary, `labrat start` bootstraps and auto-launches research campaigns, Karpathy smoke test harness validates the eval pipeline with deterministic metrics.**

## What Happened

Three tasks assembled the CLI surface, morning report, and validation harness:

**T01 — Morning report renderer** created `generateMorningReport()`, a pure function producing terminal output from experiment data. Seven conditional sections: campaign header (name, research question, targets), experiment summary (total/kept/discarded counts), top experiments table (ranked by composite score, capped at 10), improvement trajectory (first kept → best kept with per-metric deltas), cost breakdown (from metrics ledger), duration (earliest → latest timestamp), dashboard link. Each section is silently skipped when its data is absent — no crashes, no empty placeholders. Also built `findActiveCampaignDir()` to scan `.gsd/milestones/*/slices/*/CAMPAIGN.json`. Color support via `makeColors(useColor)` helper that returns ANSI-wrapping or identity functions.

**T02 — CLI subcommands** wired the report into three entry points. `labrat report` finds the active campaign, reads experiments/config/metrics, calls `generateMorningReport()`, prints to stdout, exits 0. `labrat start` parses research flags (`--target`, `--eval`, `--metric` as `name:dir:weight`, `--max-experiments`, `--budget-per-experiment`, `--research-question`), validates required flags, creates idempotent GSD scaffold (M001-ROADMAP.md, S01-PLAN.md, CAMPAIGN.json), sets `LABRAT_AUTO_START=1`, and falls through to interactive mode. `/gsd report` interactive command shows the report via `ctx.ui.notify()`. Also fixed `.ts` → `.js` import extensions in 6 files that cli.ts dynamic imports pulled into tsc scope.

**T03 — Karpathy smoke test** created `examples/karpathy-smoke/` with a self-contained eval pipeline. `train.py` simulates training in ~48ms, computing `val_bpb` deterministically via SHA-256 hash of `compute_loss()` source and hyperparams — the metric changes when an LLM modifies the code. `eval.py` outputs `parseMetrics()`-compatible JSON to stdout. `verify.sh` validates JSON format, numeric values, and determinism (two runs, compare output). README documents the `labrat start` one-liner for manual UAT.

## Verification

All 7 checks pass:
- `npx tsx .../morning-report.test.ts` — **46 passed, 0 failed**
- `npm run build` — clean compile, no type errors
- `python3 examples/karpathy-smoke/eval.py` — `{"val_bpb": 0.91284, "train_loss": 0.839813}`
- `bash examples/karpathy-smoke/verify.sh` — PASS (JSON valid, values finite, deterministic)
- `node dist/cli.js report 2>&1 | head -5` — "No active campaign found." (no crash)
- `node dist/cli.js start --help 2>&1 | grep -q target` — PASS (shows research flags)
- `node dist/cli.js report --bogus 2>&1` — exits 0 gracefully (no crash on invalid input)

## Requirements Advanced

- R012 (CLI Commands) — `labrat report` and `labrat start` subcommands operational, with help text and graceful error handling
- R013 (Terminal Morning Report) — `generateMorningReport()` produces formatted summary with all required sections: experiments, trajectory, costs, duration, dashboard link

## Requirements Validated

- R012 — CLI subcommands work: `labrat report` reads campaign data and prints report, `labrat start` parses research flags and creates campaign scaffold, `/gsd report` available in interactive mode. Help text shows all flags. Graceful handling of no-campaign and invalid-input states.
- R013 — Morning report shows all required sections from synthetic data (46 contract tests). Campaign header, experiment summary (run/kept/discarded counts), top experiments ranked by composite score, improvement trajectory (first → best with deltas), cost breakdown, duration, dashboard link. Missing data sections silently skipped. NO_COLOR respected via useColor parameter.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- Fixed `.ts` → `.js` import extensions in 6 upstream files (morning-report.ts, eval-runner.ts, state.ts, files.ts, worktree.ts, preferences.ts) — not in the task plan but required because cli.ts dynamic imports pulled resource files into tsc's type-checking scope.
- Added `--help` deferral logic for `labrat start --help` — the global `--help` handler was consuming the flag before the start subcommand handler could show its own help.

## Known Limitations

- `labrat start` creates a fixed M001/S01 scaffold structure — no support for custom milestone/slice IDs (adequate for MVP, revisable per D035)
- End-to-end UAT with real LLM (Karpathy smoke test running autonomously) requires manual human testing — the harness is ready but the full loop test is a UAT activity
- `stop` and `status` CLI commands not yet implemented (R012 lists them but S07 focused on `start` and `report` which are the critical path)

## Follow-ups

- Manual UAT: run `labrat start --target examples/karpathy-smoke/train.py --eval "python3 examples/karpathy-smoke/eval.py" --metric val_bpb:min:1.0` with a real LLM to validate the full autonomous loop
- Consider implementing `labrat stop` and `labrat status` commands (lower priority — interactive mode handles these)

## Files Created/Modified

- `src/resources/extensions/gsd/morning-report.ts` — new module: `generateMorningReport()`, `findActiveCampaignDir()`, `MorningReportInput`
- `src/resources/extensions/gsd/tests/morning-report.test.ts` — 46 contract tests for report formatter
- `src/cli.ts` — added `report` and `start` subcommands, extended flag parsing, updated help text
- `src/resources/extensions/gsd/commands.ts` — added `/gsd report` interactive command
- `src/resources/extensions/gsd/index.ts` — added auto-start trigger in session_start hook
- `src/resources/extensions/gsd/eval-runner.ts` — fixed .ts → .js import extensions
- `src/resources/extensions/gsd/state.ts` — fixed .ts → .js import extensions
- `src/resources/extensions/gsd/files.ts` — fixed .ts → .js import extensions
- `src/resources/extensions/gsd/worktree.ts` — fixed .ts → .js import extensions
- `src/resources/extensions/gsd/preferences.ts` — fixed .ts → .js import extensions
- `examples/karpathy-smoke/train.py` — deterministic training script with hash-based metrics
- `examples/karpathy-smoke/eval.py` — eval wrapper outputting parseMetrics()-compatible JSON
- `examples/karpathy-smoke/verify.sh` — pipeline validation script
- `examples/karpathy-smoke/README.md` — usage docs with labrat start one-liner

## Forward Intelligence

### What the next slice should know
- This is the final slice of M001. The milestone is complete. Next work is M002 (Structured Research & Intelligence).
- The full eval pipeline is validated with deterministic metrics but the autonomous loop with a real LLM remains a manual UAT activity.
- `labrat start` creates a fixed scaffold — M002 may want to make this more flexible.

### What's fragile
- `.ts` vs `.js` import extensions — any new dynamic import from cli.ts into resource files will hit this issue. All imports in resource files must use `.js` extensions.
- `labrat start` assumes M001/S01 directory structure — changing the hierarchy mapping (D002) would require updating the scaffold creation.

### Authoritative diagnostics
- `labrat report` in any project dir — if it crashes, the morning report or campaign scanning is broken
- `bash examples/karpathy-smoke/verify.sh` — if it fails, the eval pipeline contract is broken
- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — 46 tests cover all report sections and edge cases

### What assumptions changed
- No assumptions changed — this slice was straightforward final assembly as predicted by the risk:low rating.
