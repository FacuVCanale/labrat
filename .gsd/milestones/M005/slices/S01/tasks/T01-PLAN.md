---
estimated_steps: 6
estimated_files: 38
---

# T01: Rename GSD/labrat to NightShift in all prompts, TypeScript source, and templates

**Slice:** S01 — NightShift Naming Cleanup
**Milestone:** M005

## Description

The bulk of user-facing GSD branding lives in 23 prompt markdown files, 6 TypeScript source files (guided-flow.ts, commands.ts, auto.ts, index.ts, preferences.ts, gitignore.ts), 4 template/doc files, and the ASCII logo. This task does all the source-level renaming with a strict boundary rule: only user-facing strings change. Internal identifiers (`.gsd/` directory paths, `/gsd` command routing, `@gsd/` imports, TypeScript type/class names like `GSDState`) are left untouched per D011 and D077. Test assertions that check user-facing strings are updated in sync with the content they verify.

## Steps

1. **Bulk rename prompt files** — Use sed across all 23 prompt .md files for three patterns: (a) "You are executing GSD auto-mode" → "You are executing NightShift auto-mode", (b) "GSD Skill Preferences" → "NightShift Skill Preferences", (c) system.md specific identity lines ("You are GSD" → "You are NightShift", title line). Verify each file with a quick grep to catch any remaining user-facing GSD references.

2. **Rename TypeScript user-facing strings** — In each of the 6 TS files, carefully change only user-facing string literals:
   - `guided-flow.ts`: All `title: "GSD — ..."` → `title: "NightShift — ..."` (~11 instances)
   - `commands.ts`: Description strings, notify messages, preference heading generation (~13 instances)
   - `auto.ts`: Status bar header `theme.bold("GSD")` → `theme.bold("NightShift")`, any other UI strings (~6 instances)
   - `index.ts`: Exit command description "Exit GSD" → "Exit NightShift", worktree context strings "GSD worktree" → "NightShift worktree", and other UI text (~13 instances). Do NOT touch `.gsd/` path references.
   - `preferences.ts`: Generated heading `"## GSD Skill Preferences"` → `"## NightShift Skill Preferences"` (~2 instances)
   - `gitignore.ts`: Generated comments `"GSD baseline"` → `"NightShift baseline"`, `"GSD Skill Preferences"` → `"NightShift Skill Preferences"` (~6 instances)

3. **Replace ASCII logo** — The `NIGHTSHIFT_LOGO_LINES` array in `index.ts` renders "LABRAT" in box-drawing characters. Replace with "NIGHTSHIFT" ASCII art using the same Unicode block character style, or simplify to a clean text-based logo if the 10-character width is unwieldy.

4. **Update templates and docs** — `templates/state.md` heading "# GSD State" → "# NightShift State". `templates/preferences.md` heading. `docs/preferences-reference.md` — all ~13 GSD references in user-facing documentation text. `GSD-WORKFLOW.md` content (not filename) — "GSD Workflow" → "NightShift Workflow" etc.

5. **Update test assertions** — Sync every test file that asserts on now-changed strings: prompt-loader.test.ts (`includes('GSD')` → `includes('NightShift')`), gitignore.test.ts (`'GSD baseline'` → `'NightShift baseline'`, `'GSD Skill Preferences'` → `'NightShift Skill Preferences'`), exit-command.test.ts (`"Exit GSD"` → `"Exit NightShift"`), doctor.test.ts (`"# GSD State"` → `"# NightShift State"`), files.test.ts and parsers.test.ts (test data that uses "GSD" as a title — keep if it's arbitrary test data, change if it tests generated output).

6. **Build and test** — Run `npm run build` to verify no syntax errors. Run `npm test` to verify all assertions pass. Fix any failures.

## Must-Haves

- [ ] All 23 prompt .md files use "NightShift" not "GSD" in branding lines
- [ ] All 6 TypeScript source files use "NightShift" in user-facing strings
- [ ] ASCII logo says "NIGHTSHIFT" not "LABRAT"
- [ ] Template and doc files use "NightShift" headings/content
- [ ] All test assertions match updated strings
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No `.gsd/` paths, `/gsd` commands, `@gsd/` imports, or TS type names changed

## Verification

- `npm run build` exits 0
- `npm test` exits 0
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/*.md` — zero hits (all branding replaced)
- `rg 'LABRAT' src/resources/extensions/gsd/index.ts` — zero hits (logo replaced)
- `rg -w 'GSD' src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — zero branding hits

## Inputs

- S01-RESEARCH.md — complete inventory of all files, line numbers, and boundary rules
- D011 — keep `@gsd/*` workspace names unchanged
- D077 — user-facing naming only

## Observability Impact

- **What changes:** All user-facing string output shifts from "GSD" to "NightShift". Status bar, guided-flow titles, exit command description, generated gitignore comments, and prompt identity lines all change.
- **How to inspect:** `rg -w 'NightShift' src/resources/extensions/gsd/` confirms new branding is present. `rg -w 'GSD' src/resources/extensions/gsd/prompts/` confirms old branding is gone.
- **Failure visibility:** Build errors surface via `npm run build`. Test assertion mismatches surface via `npm test`. Boundary violations detectable via `rg '\.gsd/' ... | grep -i nightshift`.
- **No runtime signals change** — this is a string-content rename, not a behavioral change.

## Expected Output

- 23 prompt files with "NightShift" branding
- 6 TypeScript files with "NightShift" UI strings
- New ASCII logo
- Updated templates and docs
- Updated test assertions
- Clean build and test run
