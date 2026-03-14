---
estimated_steps: 5
estimated_files: 2
---

# T01: Morning report renderer with contract tests

**Slice:** S07 — CLI, Morning Report & Smoke Test
**Milestone:** M001

## Description

Create the `morning-report.ts` module with a pure `generateMorningReport()` function that takes experiment data, campaign config, cost data, and dashboard URL as inputs and produces a formatted terminal string. This is the core of R013 (Terminal Morning Report). The function is pure — no I/O in the formatter, just string assembly — making it fully contract-testable.

Also create `findActiveCampaignDir()` to scan `.gsd/milestones/*/slices/*/CAMPAIGN.json` and return the first campaign directory, used by both `labrat report` (T02) and the report function itself.

## Steps

1. Create `src/resources/extensions/gsd/morning-report.ts` with:
   - `MorningReportInput` interface: `{ experiments: ExperimentResult[], campaign: CampaignConfig, ledgerUnits: UnitMetrics[] | null, dashboardUrl: string | null, useColor: boolean }`
   - `generateMorningReport(input: MorningReportInput): string` — the main formatter
   - Report sections: campaign header (name, research question, target files), experiment summary (total/kept/discarded counts), top experiments table (ranked by composite score, showing id, description snippet, metrics, decision), improvement trajectory (first kept → best kept metrics), cost breakdown (total cost, avg per experiment, from ledger units), duration (earliest → latest timestamp), dashboard link
   - Color helper: conditional ANSI codes when `useColor` is true (bold, dim, green for kept, red for discarded)
   - `findActiveCampaignDir(basePath: string): string | null` — scans `.gsd/milestones/*/slices/*/CAMPAIGN.json`, returns first match
   - Handle edge cases: no experiments (friendly message), no cost data (skip section), no dashboard URL (skip line), single experiment (no trajectory)

2. Import existing utilities: `ExperimentResult`, `CampaignConfig` from types.ts; `UnitMetrics` from metrics.ts; `formatCost`, `formatTokenCount`, `getProjectTotals` from metrics.ts; `computeCompositeScore` from eval-runner.ts

3. Create `src/resources/extensions/gsd/tests/morning-report.test.ts` following the existing contract test pattern (assert function, passed/failed counters):
   - Test `generateMorningReport` with synthetic experiment data: verify campaign header, experiment counts, top experiments section, trajectory, cost section
   - Test with zero experiments: verify friendly "No experiments" message
   - Test with single experiment: verify no trajectory (only one data point)
   - Test with mixed kept/discarded: verify correct counts and ranking
   - Test `useColor: false` produces no ANSI escape codes
   - Test `findActiveCampaignDir` with temp directory structure containing CAMPAIGN.json
   - Test `findActiveCampaignDir` returns null for empty structure

4. Verify build compiles clean with `npm run build`

5. Run tests: `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts`

## Must-Haves

- [ ] `generateMorningReport()` is a pure function — takes data in, returns string out, no file I/O
- [ ] Report includes all required sections: header, summary, top experiments, trajectory, cost, duration, dashboard link
- [ ] `useColor: false` produces zero ANSI escape codes
- [ ] `findActiveCampaignDir()` correctly scans milestone/slice directories for CAMPAIGN.json
- [ ] Edge case: no experiments produces a friendly message, not a crash
- [ ] Contract tests cover all sections and edge cases

## Verification

- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — all tests pass
- `npm run build` — exits 0, no type errors
- Grep output for no ANSI in colorless mode: test assertion covers this

## Observability Impact

- Signals added/changed: `generateMorningReport()` is the new primary diagnostic surface for campaign state
- How a future agent inspects this: call `generateMorningReport()` with data from disk, or run `labrat report` (wired in T02)
- Failure state exposed: missing data sections are skipped with clear labels, not crashes

## Inputs

- `src/resources/extensions/gsd/types.ts` — `ExperimentResult`, `CampaignConfig`, `MetricDefinition` types
- `src/resources/extensions/gsd/metrics.ts` — `UnitMetrics`, `getProjectTotals()`, `formatCost()`, `formatTokenCount()` exports
- `src/resources/extensions/gsd/eval-runner.ts` — `computeCompositeScore()` for ranking experiments
- S04 summary — `readAllExperiments()`, `readBestMetrics()` available for callers
- S05 summary — `ExperimentResult.timestamp` populated in all entries
- S06 summary — `getDashboardUrl()` returns platform URL

## Expected Output

- `src/resources/extensions/gsd/morning-report.ts` — new module with `generateMorningReport()` and `findActiveCampaignDir()`
- `src/resources/extensions/gsd/tests/morning-report.test.ts` — contract tests covering all report sections and edge cases
