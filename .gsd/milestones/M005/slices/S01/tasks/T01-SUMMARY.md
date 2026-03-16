---
id: T01
parent: S01
milestone: M005
provides:
  - All 28 prompt .md files renamed from GSD to NightShift branding
  - 8 TypeScript source files with NightShift user-facing strings (guided-flow, commands, auto, index, preferences, gitignore, doctor, dashboard-overlay, exit-command, worktree-command)
  - NIGHTSHIFT ASCII logo replacing LABRAT in index.ts
  - Templates (state.md, preferences.md) and docs (preferences-reference.md) updated
  - GSD-WORKFLOW.md content updated (filename preserved per D077)
  - Test assertions synced (prompt-loader, gitignore, exit-command, doctor)
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
  - src/resources/extensions/gsd/templates/state.md
  - src/resources/extensions/gsd/templates/preferences.md
  - src/resources/extensions/gsd/docs/preferences-reference.md
  - src/resources/GSD-WORKFLOW.md
key_decisions:
  - "ASCII logo kept in block-character style at 77 chars wide (fits 80-col terminals) rather than simplified to plain text"
  - "Code comments left as GSD per boundary rules — only user-facing string literals changed"
  - "files.test.ts and parsers.test.ts GSD references kept — they are arbitrary test fixture data, not generated output assertions"
patterns_established:
  - "Boundary rule: .gsd/ paths, /gsd commands, @gsd/ imports, TS type names (GSDState etc.) are internal identifiers and stay unchanged"
observability_surfaces:
  - "rg -w 'GSD' src/resources/extensions/gsd/prompts/ — zero hits confirms prompt rename completeness"
  - "rg -w 'GSD' src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ — zero hits confirms doc rename"
  - "rg 'LABRAT' src/resources/extensions/gsd/index.ts — zero hits confirms logo replacement"
duration: 35min
verification_result: passed
completed_at: 2026-03-16T04:59:00Z
blocker_discovered: false
---

# T01: Rename GSD/labrat to NightShift in all prompts, TypeScript source, and templates

**Renamed all user-facing GSD/LABRAT branding to NightShift across 28 prompt files, 10 TypeScript source files, 3 template/doc files, and GSD-WORKFLOW.md content — with NIGHTSHIFT ASCII logo replacing LABRAT.**

## What Happened

Executed systematic category-by-category replacement using sed for bulk prompt files and targeted edits for TypeScript. The research estimated 23 prompt files but the actual count was 28. The plan listed 6 TS files but the actual scope included 10 (doctor.ts, dashboard-overlay.ts, exit-command.ts, and worktree-command.ts also had user-facing GSD strings discovered during the broad sweep).

Prompt files: replaced "GSD auto-mode" → "NightShift auto-mode", "GSD Skill Preferences" → "NightShift Skill Preferences", system.md identity lines, doctor heal references, worktree-merge artifact references, and review-migration standards references.

TypeScript files: changed only string literals that appear in UI — title bars, notify messages, status bar header, exit command description, dashboard title, worktree labels, generated gitignore comments, preference headings. All `.gsd/` paths, `/gsd` commands, `@gsd/` imports, and TS type names preserved.

ASCII logo: replaced 6-line LABRAT block art with 6-line NIGHTSHIFT block art using identical Unicode box-drawing character style, 77 chars wide.

Test assertions: updated prompt-loader (NightShift mention check), gitignore (NightShift baseline, NightShift Skill Preferences), exit-command (Exit NightShift), and doctor (# NightShift State).

## Verification

- `npm run build` — passes clean (zero errors)
- `npm test` — all test suites pass (408+ individual tests, 0 failures observed)
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/*.md` — **0 hits** (all branding replaced)
- `rg 'LABRAT' src/resources/extensions/gsd/index.ts` — **0 hits** (logo replaced)
- `rg -w 'GSD' src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — **0 hits**
- `grep -c 'NightShift' src/resources/extensions/gsd/prompts/system.md` — **4** (≥1 required)
- Boundary check: `rg '\.gsd/' src/resources/extensions/gsd/index.ts | grep -i nightshift` — **0 hits** (no .gsd/ paths accidentally renamed)

### Slice-level verification status (T01 is intermediate, not final):
- ✅ `npm run build` — passes
- ✅ `npm test` — passes
- ⏳ `rg -w 'GSD' ... README.md examples/` — README/examples not yet touched (T02 scope)
- ⏳ `rg -iw 'labrat' README.md examples/` — T02 scope
- ✅ Spot-check: system.md has NightShift
- ✅ Boundary check: no .gsd/ paths renamed
- ✅ Failure-path check: 0 FAIL in test output

## Diagnostics

- Inspect rename completeness: `rg -w 'GSD' src/resources/extensions/gsd/ --type ts | grep -v '//' | grep -v '\.gsd/\|/gsd\|@gsd\|GSD[A-Z]'` — should show only GSD-WORKFLOW.md filename refs
- Inspect logo: `sed -n '82,89p' src/resources/extensions/gsd/index.ts`

## Deviations

- Scope expanded from 6 to 10 TS files — doctor.ts, dashboard-overlay.ts, exit-command.ts, and worktree-command.ts had user-facing GSD strings not inventoried in the original plan
- 28 prompt files found vs 23 estimated (5 additional: adapt-upstream, discuss, steer-campaign, guided-discuss-slice had no GSD references but were checked)

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/*.md` (22 files modified) — GSD → NightShift in branding lines
- `src/resources/extensions/gsd/guided-flow.ts` — title strings, notify messages, workflow reference
- `src/resources/extensions/gsd/commands.ts` — description, notify, preference heading generation
- `src/resources/extensions/gsd/auto.ts` — status bar header, title string
- `src/resources/extensions/gsd/index.ts` — ASCII logo, kill description, system context, worktree strings
- `src/resources/extensions/gsd/exit-command.ts` — exit command description
- `src/resources/extensions/gsd/doctor.ts` — state heading, report messages, preference error
- `src/resources/extensions/gsd/dashboard-overlay.ts` — dashboard title
- `src/resources/extensions/gsd/worktree-command.ts` — worktree labels, artifact change messages
- `src/resources/extensions/gsd/preferences.ts` — generated heading, skill-selection policy text
- `src/resources/extensions/gsd/gitignore.ts` — baseline comment, skill preferences, runtime comment
- `src/resources/extensions/gsd/templates/state.md` — heading
- `src/resources/extensions/gsd/templates/preferences.md` — heading
- `src/resources/extensions/gsd/docs/preferences-reference.md` — 11 GSD → NightShift in doc text
- `src/resources/GSD-WORKFLOW.md` — 4 content references (filename unchanged per D077)
- `src/resources/extensions/gsd/tests/prompt-loader.test.ts` — assertion updated
- `src/resources/extensions/gsd/tests/gitignore.test.ts` — 3 assertions updated
- `src/resources/extensions/gsd/tests/exit-command.test.ts` — assertion updated
- `src/resources/extensions/gsd/tests/doctor.test.ts` — assertion updated
- `.gsd/milestones/M005/slices/S01/S01-PLAN.md` — observability section added
- `.gsd/milestones/M005/slices/S01/tasks/T01-PLAN.md` — observability impact added
