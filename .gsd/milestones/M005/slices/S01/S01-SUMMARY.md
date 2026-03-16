---
id: S01
parent: M005
milestone: M005
provides:
  - All 28 prompt .md files say NightShift instead of GSD in branding lines
  - 10 TypeScript source files with NightShift user-facing strings
  - NIGHTSHIFT ASCII logo replacing LABRAT in index.ts
  - Templates (state.md, preferences.md) and docs (preferences-reference.md) updated
  - GSD-WORKFLOW.md content updated (filename preserved per D077)
  - README.md and examples say NightShift/nightshift instead of GSD/labrat
  - Test assertions synced across 4 test files
requires: []
affects:
  - S03
key_files:
  - src/resources/extensions/gsd/prompts/system.md
  - src/resources/extensions/gsd/index.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/auto.ts
  - src/resources/extensions/gsd/doctor.ts
  - src/resources/extensions/gsd/dashboard-overlay.ts
  - src/resources/extensions/gsd/exit-command.ts
  - src/resources/extensions/gsd/worktree-command.ts
  - src/resources/extensions/gsd/preferences.ts
  - src/resources/extensions/gsd/gitignore.ts
  - README.md
  - examples/karpathy-smoke/README.md
key_decisions:
  - "D077: User-facing naming only — .gsd/ paths, /gsd commands, @gsd/ imports, TS type names unchanged"
  - "D081: ASCII logo kept in block-character style at 77 chars wide (fits 80-col terminals)"
  - "D082: Historical GSD references kept as predecessor proper nouns in README (3 instances)"
  - "D083: Test fixture data containing GSD kept unchanged (files.test.ts, parsers.test.ts) — only generated output assertions updated"
patterns_established:
  - "Boundary rule: .gsd/ paths, /gsd commands, @gsd/ imports, TS type names are internal identifiers and stay unchanged"
  - "README GSD classification: remaining hits are all historical predecessor refs or internal identifiers — zero product-name branding for current product"
observability_surfaces:
  - "rg -w 'GSD' src/resources/extensions/gsd/prompts/ — zero hits confirms prompt rename completeness"
  - "rg -iw 'labrat' README.md examples/ src/resources/extensions/gsd/index.ts — zero hits confirms full cleanup"
  - "rg -w 'GSD' README.md — only historical/internal hits (7 total)"
drill_down_paths:
  - .gsd/milestones/M005/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S01/tasks/T02-SUMMARY.md
duration: 47min
verification_result: passed
completed_at: 2026-03-16T04:24:00Z
---

# S01: NightShift Naming Cleanup

**All user-facing surfaces (28 prompts, 10 TS files, templates, docs, README, examples) renamed from GSD/labrat to NightShift — zero branding leaks, build and 726 tests pass.**

## What Happened

T01 performed bulk rename across source code: sed across 28 prompt .md files (5 more than the 23 estimated), targeted edits in 10 TypeScript files (4 more than the 6 planned — doctor.ts, dashboard-overlay.ts, exit-command.ts, worktree-command.ts discovered during sweep), replaced the 6-line LABRAT ASCII logo with NIGHTSHIFT in identical block-character style, updated templates and docs. Test assertions in 4 test files synced.

T02 updated README.md (product title, ~25 branding refs, 5 npm package refs) and examples/karpathy-smoke/README.md (4 command refs). Preserved 7 README GSD references as historical predecessor proper nouns or internal identifiers.

## Verification

- `npm run build` — passes clean
- `npm test` — 726 tests pass, 0 failures
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — **0 hits**
- `rg -iw 'labrat' README.md examples/ src/resources/extensions/gsd/index.ts` — **0 hits**
- `rg -w 'GSD' README.md` — 7 hits, all historical/internal (verified line-by-line)
- `rg -w 'GSD' examples/` — **0 hits**
- `grep -c 'NightShift' src/resources/extensions/gsd/prompts/system.md` — **4**
- Boundary check: `rg '\.gsd/' src/resources/extensions/gsd/index.ts | grep -i nightshift` — **0 hits**
- Failure-path: `npm test 2>&1 | grep -c 'FAIL'` — **0**

## Requirements Advanced

- R042 — All user-facing surfaces now say NightShift consistently

## Requirements Validated

- R042 — Zero GSD/labrat branding in prompts, CLI output, error messages, README, examples. Comprehensive grep verification proves completeness. Internal identifiers preserved.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Scope expanded from 6 to 10 TS files (doctor.ts, dashboard-overlay.ts, exit-command.ts, worktree-command.ts had user-facing GSD strings not in original plan)
- 28 prompt files found vs 23 estimated

## Known Limitations

- The CLI binary is still `gsd` and interactive slash commands are `/gsd` — these are internal identifiers per D077, not user-facing product branding
- `src/resources/extensions/gsd/` directory path unchanged per D077

## Follow-ups

- none

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/*.md` (22 files) — GSD → NightShift in branding lines
- `src/resources/extensions/gsd/guided-flow.ts` — title strings, notify messages
- `src/resources/extensions/gsd/commands.ts` — description, notify, heading generation
- `src/resources/extensions/gsd/auto.ts` — status bar header, title string
- `src/resources/extensions/gsd/index.ts` — ASCII logo, kill description, system context
- `src/resources/extensions/gsd/exit-command.ts` — exit command description
- `src/resources/extensions/gsd/doctor.ts` — state heading, report messages
- `src/resources/extensions/gsd/dashboard-overlay.ts` — dashboard title
- `src/resources/extensions/gsd/worktree-command.ts` — worktree labels
- `src/resources/extensions/gsd/preferences.ts` — generated heading, policy text
- `src/resources/extensions/gsd/gitignore.ts` — baseline comment, skill preferences
- `src/resources/extensions/gsd/templates/state.md` — heading
- `src/resources/extensions/gsd/templates/preferences.md` — heading
- `src/resources/extensions/gsd/docs/preferences-reference.md` — 11 GSD → NightShift
- `src/resources/GSD-WORKFLOW.md` — 4 content references (filename unchanged)
- `src/resources/extensions/gsd/tests/prompt-loader.test.ts` — assertion updated
- `src/resources/extensions/gsd/tests/gitignore.test.ts` — 3 assertions updated
- `src/resources/extensions/gsd/tests/exit-command.test.ts` — assertion updated
- `src/resources/extensions/gsd/tests/doctor.test.ts` — assertion updated
- `README.md` — Product title, npm refs, ~25 branding refs
- `examples/karpathy-smoke/README.md` — 4 command refs

## Forward Intelligence

### What the next slice should know
- All prompts now say NightShift. Any new prompts generated by S03's scaffold must use NightShift branding, not GSD.
- The boundary rule is firm: `.gsd/` paths, `/gsd` commands, `@gsd/` imports stay as-is. Only string literals shown to users change.

### What's fragile
- The ASCII logo in index.ts is hand-aligned at 77 chars wide — editing it requires matching the Unicode box-drawing character positions exactly

### Authoritative diagnostics
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/` — zero hits is the authoritative signal that prompts are clean
- `rg -iw 'labrat' README.md examples/` — zero hits confirms npm/CLI cleanup

### What assumptions changed
- Plan estimated 23 prompt files and 6 TS files — actual was 28 prompts and 10 TS files. Future file counts from plan estimates should be treated as lower bounds.
