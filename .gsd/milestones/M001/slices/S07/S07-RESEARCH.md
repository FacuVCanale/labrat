# S07: CLI, Morning Report & Smoke Test — Research

**Date:** 2026-03-14

## Summary

S07 is the capstone slice for M001. It owns two active requirements — R012 (CLI Commands) and R013 (Terminal Morning Report) — and must produce the end-to-end smoke test that proves the entire research loop works. The good news: the heavy infrastructure is done. All experiment loop machinery (S02–S06) is validated with 300+ contract tests. S07's job is wiring CLI entry points to existing functions, building a report renderer from existing data readers, and writing a smoke test harness.

The CLI work splits into two distinct patterns: **interactive subcommands** (start, auto, stop, status) that operate through the existing `/gsd` command system inside the TUI, and a **pure CLI subcommand** (report) that reads from disk and prints to stdout without launching the TUI. The `start` command is the key new piece — it creates a CAMPAIGN.json from CLI flags and then delegates to the existing `startAuto()` machinery.

The morning report is a pure function: read EXPERIMENT-LOG.jsonl + metrics.json from disk, compute aggregates, format as colored terminal output. All data readers already exist (`readAllExperiments`, `readBestMetrics`, `getProjectTotals`, `formatCost`). The report module is self-contained, testable without mocks.

## Recommendation

### Approach: Three-task split

**T01 — CLI subcommands (`start`, `report`).** Add `start` and `report` as top-level CLI subcommands in `cli.ts`, alongside existing `config` and `update`. The `start` command parses `--target`, `--eval`, `--metric`, `--direction`, `--max-experiments` flags, creates a CAMPAIGN.json in the appropriate slice directory, and launches interactive mode which immediately fires `/gsd auto`. The `report` subcommand is pure — read experiment log + metrics ledger from disk, call the morning report formatter, print to stdout, exit. Also wire `report` as `/gsd report` for interactive use.

**T02 — Morning report renderer.** New module `morning-report.ts` with a pure `generateMorningReport()` function. Inputs: experiment log (ExperimentResult[]), metrics ledger (MetricsLedger), campaign config (CampaignConfig), MLOps dashboard URL (string|null). Output: formatted string with ANSI colors. Sections: campaign header, experiment summary (run/kept/discarded counts), top experiments ranked by composite score, improvement trajectory (first → best metrics), cost breakdown, duration, and dashboard link. Contract-testable — no I/O in the formatter, just string assembly.

**T03 — Karpathy smoke test harness.** Create `examples/karpathy-smoke/` with a minimal `train.py` (trivially fast — no actual ML training, just deterministic metric output that varies based on code modifications), an `eval.py` that runs `train.py` and outputs JSON metrics, and a shell script that runs `labrat start` with the right flags. The smoke test validates the full loop: campaign creation → experiment dispatch → LLM modification → eval → keep/discard → log → report. This is UAT-level verification.

### Why this approach

1. **CLI subcommands in `cli.ts`** — follows the existing pattern (`config`, `update`). These are top-level `labrat <subcommand>` entry points, not `/gsd` subcommands. The `report` command works without the TUI, making it useful for CI/scripts.
2. **Separate morning report module** — keeps formatting logic testable without TUI dependencies. Same pattern as `mlops-integration.ts` — self-contained module with contract tests.
3. **Smoke test as example project** — a real but trivially fast scenario that proves the loop works. Avoids requiring actual ML infrastructure.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Experiment log reading | `readAllExperiments()` in eval-runner.ts | Already crash-safe, line-by-line JSON parsing, 73 tests |
| Best metrics extraction | `readBestMetrics()` in eval-runner.ts | Scans JSONL for latest kept experiment |
| Cost/token aggregation | `getProjectTotals()`, `formatCost()`, `formatTokenCount()` in metrics.ts | Full aggregate pipeline already tested |
| Campaign config parsing | `parseCampaignConfig()` in state.ts | Validates shape, returns null on malformed |
| MLOps dashboard URL | `mlopsClient.getDashboardUrl()` in mlops-integration.ts | Platform-specific URL resolution |
| Diff-stat summaries | `extractDiffStat()` in eval-runner.ts | Git-based change summaries |
| Compressed history | `compressExperimentHistory()` in eval-runner.ts | Newest-first one-liner format |

## Existing Code and Patterns

- `src/cli.ts` — CLI entry point. Subcommands are `cliFlags.messages[0] === 'name'` checks before interactive mode launch. Pattern: parse args, do work, `process.exit(0)`. `start` and `report` follow this exact pattern.
- `src/resources/extensions/gsd/commands.ts` — `/gsd` interactive command with subcommand routing. Already has `auto`, `stop`, `status`, `next`, `queue`, `discuss`. Add `report` subcommand here for interactive access.
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments()`, `readBestMetrics()`, `compressExperimentHistory()`, `extractDiffStat()` — all the experiment data readers the morning report needs.
- `src/resources/extensions/gsd/metrics.ts` — `loadLedger()` (private but pattern is readable), `getProjectTotals()`, `formatCost()`, `formatTokenCount()` — cost/token formatting infrastructure.
- `src/resources/extensions/gsd/mlops-integration.ts` — `getDashboardUrl()` returns platform URL string.
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()`, `countExperiments()`, `deriveState()`.
- `src/resources/extensions/gsd/auto.ts` — `startAuto()` is the entry point for autonomous mode. Already handles campaign detection, MLOps init, crash recovery.
- `src/resources/extensions/gsd/types.ts` — `ExperimentResult`, `CampaignConfig`, `EvaluationConfig`, `MetricDefinition`.
- `src/loader.ts` — environment setup before cli.ts runs. Sets `LABRAT_VERSION`, `LABRAT_BIN_PATH`, etc.

## Constraints

- **`loadLedger()` is private in metrics.ts** — the morning report needs the ledger data. Options: (a) export `loadLedger`, (b) read the JSON file directly in the report module via `readFileSync(join(basePath, '.gsd', 'metrics.json'))`, (c) add a new exported function. Option (b) is simplest and avoids coupling; option (a) is cleanest. Recommend (a) — export `loadLedger`.
- **`labrat start` must work without existing .gsd/ structure** — it needs to bootstrap the milestone/slice directory, create CAMPAIGN.json, and then enter auto-mode. The existing `startAuto()` already bootstraps `.gsd/` if missing, but it expects the GSD hierarchy to trigger campaign detection in `deriveState()`.
- **CAMPAIGN.json must live in a slice directory** — per D012. `labrat start` needs to create a minimal milestone + slice structure (or a well-known location like `.gsd/milestones/M001/slices/S01/`) so `parseCampaignConfig()` finds it.
- **`labrat report` must work without the TUI** — pure stdout output. It reads `.gsd/` files from disk. No `ExtensionContext`, no `ctx.ui`. Just `process.stdout.write()` + `process.exit(0)`.
- **ANSI color codes in report** — must respect `NO_COLOR` env var for CI pipelines. Use conditional coloring.
- **Smoke test can't require actual ML training** — must complete in seconds, not hours. Use a trivial Python script that outputs deterministic metrics based on code content.
- **`labrat start` must parse CLI flags** — the existing `parseCliArgs()` in cli.ts only handles `--mode`, `--print`, `--continue`, `--model`, etc. Need to extend it (or parse in the subcommand handler) for `--target`, `--eval`, `--metric`, `--direction`, `--max-experiments`, `--budget-per-experiment`.
- **`labrat report` finds the active campaign** — needs to discover which slice has a CAMPAIGN.json. Can use `deriveState()` to find active milestone/slice, or scan `.gsd/milestones/*/slices/*/CAMPAIGN.json`.

## Common Pitfalls

- **Testing auto-mode end-to-end in CI** — `startAuto()` requires `ExtensionCommandContext` which comes from the TUI framework. The smoke test should test at the subprocess level (`labrat start ...` as a child process) or validate individual components. Don't try to unit-test `startAuto()` directly.
- **CAMPAIGN.json location for `labrat start`** — if no GSD structure exists, `labrat start` creates one. But `deriveState()` requires a roadmap, plan, etc. to reach the `experimenting` phase. The campaign detection in `deriveState()` fires when a slice has a plan AND a CAMPAIGN.json. Need to ensure a minimal plan exists or modify the detection path. Per line 409 of state.ts, campaign detection requires `slicePlanContent` to be truthy (line 384 checks for plan existence before reaching campaign detection at 409). **This means `labrat start` must create both a CAMPAIGN.json and a minimal slice plan** (at minimum an S-PLAN.md).
- **`labrat report` when no experiments exist** — must handle gracefully with a "No experiments found" message, not crash.
- **Metrics ledger vs experiment log** — the metrics ledger (`metrics.json`) tracks LLM cost/tokens per unit. The experiment log (`EXPERIMENT-LOG.jsonl`) tracks experiment results/metrics. The morning report needs both. Don't confuse them.
- **Color in piped output** — if stdout is piped (not a TTY), disable ANSI colors. Check `process.stdout.isTTY` and `NO_COLOR` env.

## Open Risks

- **`labrat start` bootstrapping complexity** — creating the full GSD hierarchy (milestone dir, roadmap, slice dir, plan, CAMPAIGN.json) from CLI flags is more setup code than the actual report formatter. Need to keep it minimal — a known scaffold, not a flexible generator.
- **Smoke test reliability** — the Karpathy smoke test uses a real LLM to modify code. If the LLM makes changes that break the eval script, the test "fails" even though the system worked correctly. The smoke test validates the loop, not the LLM's research quality. Need clear pass/fail criteria: "did N experiments run and produce results?" not "did metrics improve?"
- **Interactive mode launch from `labrat start`** — the `start` subcommand needs to create the campaign structure and then launch interactive mode with auto-mode pre-armed. The existing `config` and `update` subcommands exit after completion. `start` needs to fall through to interactive mode instead. This is a different pattern.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Node.js CLI | eddiebe147/claude-settings@cli-builder | not relevant (generic CLI builder, we have our own pattern) |
| TypeScript | n/a | built-in knowledge sufficient |

## Sources

- CLI entry point pattern (source: `src/cli.ts` lines 88-101 — subcommand detection via `cliFlags.messages[0]`)
- Campaign config format (source: `src/resources/extensions/gsd/state.ts` lines 56-82 — `parseCampaignConfig()`)
- Experiment data readers (source: `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments`, `readBestMetrics`, `compressExperimentHistory`)
- Cost aggregation (source: `src/resources/extensions/gsd/metrics.ts` — `getProjectTotals`, `formatCost`, `formatTokenCount`)
- State derivation campaign detection (source: `src/resources/extensions/gsd/state.ts` lines 384-460 — requires slice plan before campaign detection fires)
- MLOps dashboard URL (source: `src/resources/extensions/gsd/mlops-integration.ts` — `getDashboardUrl()`)
- D012: CAMPAIGN.json in slice directory
- D013: JSONL experiment log format
- D014: Experiment commit convention `experiment(EYYY):`
