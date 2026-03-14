# S07: CLI, Morning Report & Smoke Test

**Goal:** `labrat start` runs a campaign end-to-end, `labrat report` shows terminal summary, Karpathy smoke test harness validates the full loop.
**Demo:** Run `labrat report` on a project with experiment data → see formatted summary with top experiments, improvement trajectory, costs, and dashboard link. Run `python examples/karpathy-smoke/eval.py` → see valid JSON metrics. Run `labrat start --help` → see research campaign flags.

## Must-Haves

- `generateMorningReport()` pure function produces formatted terminal output from experiment data
- Report includes: campaign header, experiment summary, top experiments, improvement trajectory, cost breakdown, duration, dashboard link
- Report respects `NO_COLOR` env var and non-TTY contexts
- `labrat report` reads campaign data from disk, prints report to stdout, exits without TUI
- `labrat start` parses `--target`, `--eval`, `--metric`, `--direction`, `--max-experiments`, `--budget-per-experiment` flags
- `labrat start` creates GSD scaffold (milestone dir, slice plan, CAMPAIGN.json) and launches interactive mode with auto-start
- `/gsd report` available as interactive subcommand
- Karpathy smoke test harness with trivially fast eval script producing deterministic metrics
- Graceful handling of empty state (no experiments, no campaign)

## Proof Level

- This slice proves: final-assembly
- Real runtime required: yes (CLI subcommands, file I/O)
- Human/UAT required: yes (Karpathy end-to-end test with real LLM is manual UAT)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — contract tests for report formatter
- `npm run build` — clean compile
- `python3 examples/karpathy-smoke/eval.py` — outputs valid JSON metrics
- `node dist/cli.js report 2>&1 | head -5` — prints "No active campaign found" or formatted report (no crash)
- `node dist/cli.js start --help 2>&1 | grep -q target` — help shows research flags
- `node dist/cli.js report --bogus 2>&1` — exits without crash on invalid input; verifies graceful error handling

## Observability / Diagnostics

- Runtime signals: `labrat report` exits 0 with formatted output or "No active campaign" message; exits 1 on unexpected error
- Inspection surfaces: `labrat report` is the primary diagnostic — run it to see campaign state at a glance
- Failure visibility: report shows kept/discarded counts, cost totals — obvious if data is missing or corrupt
- Redaction constraints: none (experiment metrics are not secret)

## Integration Closure

- Upstream surfaces consumed: `readAllExperiments()`, `readBestMetrics()`, `parseCampaignConfig()` from eval-runner.ts/state.ts; `getProjectTotals()`, `formatCost()`, `formatTokenCount()` from metrics.ts; `createMLOpsClient()`, `getDashboardUrl()` from mlops-integration.ts; `startAuto()` from auto.ts
- New wiring introduced in this slice: `labrat start` and `labrat report` CLI entry points in cli.ts; `/gsd report` interactive command in commands.ts; auto-start trigger in index.ts session_start hook; morning-report.ts module
- What remains before the milestone is truly usable end-to-end: nothing — this is the final assembly slice

## Tasks

- [x] **T01: Morning report renderer with contract tests** `est:40m`
  - Why: R013 requires a terminal morning report. This is the pure formatting function that both `labrat report` and `/gsd report` consume.
  - Files: `src/resources/extensions/gsd/morning-report.ts`, `src/resources/extensions/gsd/tests/morning-report.test.ts`
  - Do: Create `generateMorningReport()` pure function with sections: campaign header, experiment summary (run/kept/discarded), top experiments ranked by composite score, improvement trajectory (first baseline → best), cost breakdown, duration, dashboard link. Add `findActiveCampaignDir()` to scan `.gsd/milestones/*/slices/*/CAMPAIGN.json`. Respect `useColor` parameter (driven by `NO_COLOR` and TTY detection). Read metrics ledger directly from `.gsd/metrics.json`. Contract tests with synthetic experiment data.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` passes, `npm run build` clean
  - Done when: `generateMorningReport()` produces correct formatted output for all sections including edge cases (no experiments, no cost data, no dashboard)

- [x] **T02: CLI subcommands (`start`, `report`) and `/gsd report` interactive command** `est:45m`
  - Why: R012 requires CLI commands. This wires the morning report into real entry points and adds campaign bootstrapping for `labrat start`.
  - Files: `src/cli.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/gsd/morning-report.ts`
  - Do: Add `labrat report` subcommand in cli.ts — find campaign dir, read data, call `generateMorningReport()`, print to stdout, exit. Add `labrat start` subcommand — parse research flags (`--target`, `--eval`, `--metric`, `--direction`, `--max-experiments`, `--budget-per-experiment`), create GSD scaffold (milestone dir + roadmap, slice dir + plan, CAMPAIGN.json), set `process.env.LABRAT_AUTO_START = '1'`, fall through to interactive mode. Add auto-start trigger in index.ts `session_start` hook. Add `/gsd report` in commands.ts. Update help text in cli.ts.
  - Verify: `npm run build` clean, `node dist/cli.js report` runs without crash, `node dist/cli.js start --help` shows research flags
  - Done when: both CLI subcommands work, `/gsd report` shows report in interactive mode, `labrat start` creates correct campaign scaffold

- [x] **T03: Karpathy smoke test harness** `est:25m`
  - Why: End-to-end validation of the full research loop. This is the UAT artifact that proves the system works.
  - Files: `examples/karpathy-smoke/train.py`, `examples/karpathy-smoke/eval.py`, `examples/karpathy-smoke/verify.sh`, `examples/karpathy-smoke/README.md`
  - Do: Create trivial `train.py` that computes a deterministic "val_bpb" metric based on code content (hash-derived, not random). Create `eval.py` that runs `train.py` and outputs JSON metrics to stdout. Create `verify.sh` that validates the eval pipeline works (runs eval, parses output, checks JSON format). Create README with `labrat start` one-liner for manual UAT. Verify eval.py produces parseable output that `parseMetrics()` can consume.
  - Verify: `python3 examples/karpathy-smoke/eval.py` outputs valid JSON, `bash examples/karpathy-smoke/verify.sh` exits 0
  - Done when: smoke test harness is ready for manual UAT, eval pipeline produces valid metrics, README documents the one-liner

## Files Likely Touched

- `src/resources/extensions/gsd/morning-report.ts`
- `src/resources/extensions/gsd/tests/morning-report.test.ts`
- `src/cli.ts`
- `src/resources/extensions/gsd/commands.ts`
- `src/resources/extensions/gsd/index.ts`
- `examples/karpathy-smoke/train.py`
- `examples/karpathy-smoke/eval.py`
- `examples/karpathy-smoke/verify.sh`
- `examples/karpathy-smoke/README.md`
