---
id: T01
parent: S07
milestone: M001
provides:
  - "generateMorningReport() pure formatter — data in, formatted terminal string out"
  - "findActiveCampaignDir() scanner — locates CAMPAIGN.json in milestone/slice tree"
  - "MorningReportInput interface for callers"
key_files:
  - src/resources/extensions/gsd/morning-report.ts
  - src/resources/extensions/gsd/tests/morning-report.test.ts
key_decisions:
  - "Report sections are conditionally included — missing data (no cost, no dashboard, no trajectory) silently skips the section rather than showing empty/zero placeholders"
  - "findActiveCampaignDir scans sorted milestone/slice dirs and returns the first match — deterministic ordering"
patterns_established:
  - "Pure formatter pattern: data interface in, string out, useColor flag for ANSI control — no I/O in the formatter"
observability_surfaces:
  - "generateMorningReport() is the primary diagnostic surface for campaign state — call it with data from disk to see experiment summary, trajectory, and costs at a glance"
duration: 15m
verification_result: passed
completed_at: 2026-03-14T14:26Z
blocker_discovered: false
---

# T01: Morning report renderer with contract tests

**Created `generateMorningReport()` pure formatter with 7 report sections, `findActiveCampaignDir()` scanner, and 46 contract tests covering all sections and edge cases.**

## What Happened

Built `morning-report.ts` with two exports:

1. **`generateMorningReport(input: MorningReportInput): string`** — pure formatter that assembles a terminal report from experiment data. Sections: campaign header (name, research question, target files), experiment summary (total/kept/discarded counts), top experiments table (ranked by composite score, capped at 10), improvement trajectory (first kept → best kept with per-metric deltas), cost breakdown (from ledger units), duration (earliest → latest experiment timestamp), dashboard link. Each section is conditionally included — no crashes on missing data.

2. **`findActiveCampaignDir(basePath: string): string | null`** — scans `.gsd/milestones/{M}/slices/{S}/CAMPAIGN.json`, returns first match (sorted alphabetically), null if none found.

Color support uses a `makeColors(useColor)` helper that returns either identity functions or ANSI-wrapping functions, ensuring `useColor: false` produces zero escape codes.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — **46 passed, 0 failed**
- `npm run build` — exits 0, no type errors
- Tests cover: full report with all sections, zero experiments (friendly message), single experiment (no trajectory), mixed kept/discarded (correct counts), useColor false (zero ANSI), useColor true (has ANSI), null/empty ledger (skip cost), null dashboard (skip line), findActiveCampaignDir with/without CAMPAIGN.json, missing .gsd dir, multiple campaigns (picks first)

### Slice-level verification status (T01/T03):
- ✅ `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — passes
- ✅ `npm run build` — clean compile
- ⏳ `python3 examples/karpathy-smoke/eval.py` — T03 scope
- ⏳ `node dist/cli.js report 2>&1 | head -5` — T02 scope (CLI not wired yet)
- ⏳ `node dist/cli.js start --help 2>&1 | grep -q target` — T02 scope
- ⏳ `node dist/cli.js report --bogus 2>&1` — T02 scope (graceful error handling)

## Diagnostics

- Call `generateMorningReport()` with data from `readAllExperiments()`, `parseCampaignConfig()`, `getLedger()`, and `getDashboardUrl()` to see a formatted campaign summary
- Missing sections are silently skipped with clear absence — no empty/zero placeholders
- The function never throws on valid input; malformed experiments with missing fields degrade gracefully

## Deviations

- Fixed JSDoc comments that contained `*/` inside block comments (e.g., `milestones/*/slices/*/CAMPAIGN.json`), which caused `tsx` to misparse the file as it terminated the comment block early. Rewrote to avoid the pattern.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/morning-report.ts` — new module with `generateMorningReport()`, `findActiveCampaignDir()`, `MorningReportInput` interface
- `src/resources/extensions/gsd/tests/morning-report.test.ts` — 46 contract tests covering all report sections and edge cases
- `.gsd/milestones/M001/slices/S07/S07-PLAN.md` — added failure-path verification step (pre-flight fix)
