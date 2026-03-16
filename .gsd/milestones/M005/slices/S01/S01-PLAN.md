# S01: NightShift Naming Cleanup

**Goal:** All user-facing surfaces (prompts, CLI output, error messages, README, examples) say "NightShift" with zero GSD/labrat leaking through. Internal identifiers (`.gsd/` paths, `/gsd` commands, `@gsd/` imports, TS type names) unchanged.
**Demo:** `rg -i '\bGSD\b' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ README.md examples/` returns zero hits in user-facing strings. `rg -i '\blabrat\b' README.md examples/` returns zero hits. `npm run build && npm test` passes.

## Must-Haves

- All 23 prompt .md files say "NightShift" instead of "GSD" in branding lines
- All TypeScript UI strings (guided-flow.ts, commands.ts, auto.ts, index.ts, preferences.ts, gitignore.ts) say "NightShift"
- ASCII logo renders "NIGHTSHIFT" not "LABRAT"
- README.md and examples say "NightShift" / "nightshift" instead of "GSD" / "labrat"
- Templates (state.md, preferences.md), docs (preferences-reference.md), and GSD-WORKFLOW.md content updated
- Test assertions updated to match new strings
- `npm run build` passes (no syntax errors from TS changes)
- `npm test` passes (assertions match updated content)
- Internal identifiers (`.gsd/`, `/gsd`, `@gsd/`, TS types, GSD-WORKFLOW.md filename) untouched

## Observability / Diagnostics

- **Inspection surface:** `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — zero user-facing hits confirms rename completeness. Any hit is a missed rename.
- **Failure visibility:** `npm run build` surfaces TS syntax errors from botched string edits. `npm test` surfaces assertion mismatches where test expectations weren't updated in sync.
- **Boundary violation detection:** `rg '\.gsd/' src/resources/extensions/gsd/index.ts | grep -i nightshift` — should return zero hits, confirming no `.gsd/` paths were accidentally renamed.
- **Redaction:** No secrets or credentials involved in this slice.

## Verification

- `npm run build` — TypeScript compiles clean
- `npm test` — all test assertions pass with updated strings
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ README.md examples/` — zero user-facing branding hits
- `rg -iw 'labrat' README.md examples/ src/resources/extensions/gsd/index.ts` — zero hits
- Spot-check: `grep -c 'NightShift' src/resources/extensions/gsd/prompts/system.md` returns ≥1
- Boundary check: `rg '\.gsd/' src/resources/extensions/gsd/index.ts | grep -i nightshift` returns zero — no `.gsd/` paths accidentally renamed
- Failure-path check: `npm test 2>&1 | grep -c 'FAIL'` returns 0 — no test files failing after rename

## Tasks

- [x] **T01: Rename GSD/labrat to NightShift in all prompts, TypeScript source, and templates** `est:45m`
  - Why: The bulk of user-facing branding lives in 23 prompt files, 6 TS source files, 4 template/doc files, and the ASCII logo. Changing these first enables build+test verification before documentation.
  - Files: `src/resources/extensions/gsd/prompts/*.md`, `src/resources/extensions/gsd/guided-flow.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/gsd/preferences.ts`, `src/resources/extensions/gsd/gitignore.ts`, `src/resources/extensions/gsd/templates/state.md`, `src/resources/extensions/gsd/templates/preferences.md`, `src/resources/extensions/gsd/docs/preferences-reference.md`, `src/resources/GSD-WORKFLOW.md`
  - Do: (1) Bulk sed across 23 prompt files for "GSD auto-mode" → "NightShift auto-mode", "GSD Skill Preferences" → "NightShift Skill Preferences", and system.md identity lines. (2) Carefully update each TS file — only user-facing strings like `title:` values, `description:` strings, `notify()` messages, status bar header, generated headings. Do NOT touch `.gsd/` paths, `/gsd` commands, `@gsd/` imports, or TS type names. (3) Replace ASCII logo art from "LABRAT" to "NIGHTSHIFT". (4) Update template/doc headings and content. (5) Update all test files that assert on the changed strings (prompt-loader, gitignore, exit-command, doctor, files, parsers, etc.). (6) `npm run build && npm test`.
  - Verify: `npm run build` passes; `npm test` passes; `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` returns only non-branding hits (path refs, type names)
  - Done when: All source code and prompt branding says NightShift, build and tests pass

- [x] **T02: Rename GSD/labrat in README and examples, run final verification** `est:20m`
  - Why: README and examples are the user's first contact with the product. Final grep verification proves R042 completeness.
  - Files: `README.md`, `examples/karpathy-smoke/README.md`
  - Do: (1) Update README.md — change product name from "GSD" to "NightShift", "labrat" npm refs to "nightshift". Keep historical proper nouns where GSD is referenced as the predecessor project (e.g., "Built on the GSD-2 codebase"). (2) Update examples/karpathy-smoke/README.md — `labrat` → `nightshift` in command examples. (3) Run final comprehensive verification: `rg -i '\bGSD\b|\blabrat\b'` across all user-facing surfaces, filtering out internal identifiers. Every remaining hit must be either an internal identifier (`.gsd/`, `/gsd`, `@gsd/`, TS types) or a historical proper noun.
  - Verify: `rg -iw 'labrat' README.md examples/` returns zero; `rg -w 'GSD' README.md` returns only historical/predecessor references; `npm run build && npm test` still passes
  - Done when: Zero unintentional GSD/labrat in user-facing surfaces; R042 satisfied

## Files Likely Touched

- `src/resources/extensions/gsd/prompts/*.md` (23 files)
- `src/resources/extensions/gsd/guided-flow.ts`
- `src/resources/extensions/gsd/commands.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/index.ts`
- `src/resources/extensions/gsd/preferences.ts`
- `src/resources/extensions/gsd/gitignore.ts`
- `src/resources/extensions/gsd/templates/state.md`
- `src/resources/extensions/gsd/templates/preferences.md`
- `src/resources/extensions/gsd/docs/preferences-reference.md`
- `src/resources/GSD-WORKFLOW.md`
- `src/resources/extensions/gsd/tests/prompt-loader.test.ts`
- `src/resources/extensions/gsd/tests/gitignore.test.ts`
- `src/resources/extensions/gsd/tests/exit-command.test.ts`
- `src/resources/extensions/gsd/tests/doctor.test.ts`
- `src/resources/extensions/gsd/tests/files.test.ts`
- `src/resources/extensions/gsd/tests/parsers.test.ts`
- `README.md`
- `examples/karpathy-smoke/README.md`
