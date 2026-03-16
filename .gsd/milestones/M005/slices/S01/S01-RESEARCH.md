# S01: NightShift Naming Cleanup — Research

**Date:** 2026-03-16

## Summary

R042 requires all user-facing surfaces to say "NightShift" with zero GSD/labrat/Labrat leaking through. The codebase has a clear split: internal plumbing already uses "nightshift" in some places (package.json `name: "nightshift"`, env vars `NIGHTSHIFT_*`, CLI `nightshift start` help text, session header renders "NightShift" with `NIGHTSHIFT_LOGO_LINES`), but user-facing branding is overwhelmingly still "GSD" across prompts, TypeScript UI strings, README, examples, docs, templates, and one test file.

The total scope is approximately **120-140 individual string changes** across 40+ files, but the changes are mechanical find-and-replace within well-defined categories. The risk is low — these are text changes in strings and markdown, not logic changes. The main danger is incomplete grep coverage (missing a surface) or breaking the boundary rule (accidentally renaming `.gsd/` paths, `/gsd` commands, or `gsd/M001/S01` branch patterns that must stay per D011/D077).

**Recommended approach:** Systematic category-by-category replacement with a final grep-based verification pass. Change prompts first (highest volume, pure markdown), then TypeScript strings (moderate volume, requires build check), then README/examples/docs/templates, then fix the two test assertions. End with `rg -i '\bGSD\b|\blabrat\b'` across all user-facing surfaces to prove zero hits remain.

## Recommendation

Work in five ordered batches to minimize risk of incomplete coverage:

1. **Prompts (25 .md files, ~35 branding instances)** — The `"You are executing GSD auto-mode"` opener appears in 11 files. `"GSD Skill Preferences"` appears in 18 prompt files. system.md has 4 branding changes (title, identity, skills line, preferences reference). These are pure text — no build needed, no logic risk.

2. **TypeScript user-facing strings (~48 instances across 5 files)** — `guided-flow.ts` has 11+ title strings. `commands.ts` has description, notify, and preference generation strings. `auto.ts` has the status bar header. `index.ts` has the LABRAT ASCII logo, exit command description, dashboard description, and worktree context. `preferences.ts` has heading generation. Requires `npm run build` to verify no syntax errors.

3. **README.md + examples (~38 instances)** — Full README rewrite from "GSD 2" to "NightShift". Examples `karpathy-smoke/README.md` has 4 `labrat` → `nightshift` changes. npm badge URLs change from `labrat` to `nightshift`.

4. **Templates and docs (4 instances)** — `templates/state.md` heading, `templates/preferences.md` heading, `docs/preferences-reference.md` (10+ GSD references), `GSD-WORKFLOW.md` content (5 branding instances — filename stays per D077).

5. **Tests (2 files, 4 assertions)** — `prompt-loader.test.ts` line 49 asserts `includes('GSD')`. `gitignore.test.ts` lines 97, 325, 332 assert GSD strings in generated content.

Then run a final verification grep to confirm zero user-facing GSD/labrat hits remain.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| ASCII art logo generation | Online generators (patorjk.com) or keep simple text | Don't manually pixel-push box-drawing characters for "NIGHTSHIFT" — use a generator or simplify to plain text since "NightShift" is already in the title line |
| Bulk string replacement | `sed -i` or editor multi-cursor | But only within each category — don't blindly replace all "GSD" because `.gsd/` paths must stay |

## Existing Code and Patterns

- `src/resources/extensions/gsd/prompts/system.md` — The system prompt is the agent's identity. Lines 1-3 say "GSD - Get Shit Done / You are GSD". This is the most visible branding change — it shapes the LLM's self-concept.
- `src/resources/extensions/gsd/prompts/*.md` — 25 prompt files with GSD branding. The pattern is consistent: line 1 is `"You are executing GSD auto-mode."` and a "GSD Skill Preferences" reference appears once per file.
- `src/resources/extensions/gsd/guided-flow.ts` — All `title:` strings use `"GSD — ..."` pattern (11 instances). These appear in the TUI header during guided mode. Change to `"NightShift — ..."`.
- `src/resources/extensions/gsd/commands.ts` — Command description says `"GSD — Get Shit Done: /gsd next|auto|..."`. The `/gsd` command references stay, but "GSD —" branding changes. Also has `notify()` messages, preference heading generation.
- `src/resources/extensions/gsd/auto.ts` line 947 — Status bar header renders `theme.bold("GSD")` alongside AUTO/NEXT mode tag. This is the persistent UI during auto-mode.
- `src/resources/extensions/gsd/index.ts` lines 82-89 — ASCII logo spells "LABRAT" in box-drawing characters despite the variable being named `NIGHTSHIFT_LOGO_LINES`. The title line below already says "NightShift". The logo art must change.
- `src/resources/extensions/gsd/index.ts` line 302 — `"You are working inside a GSD worktree."` and line 308 `"GSD state resolve against the worktree path"` — user-facing context injected into agent prompts.
- `src/resources/extensions/gsd/preferences.ts` line 290 — Generates heading `"## GSD Skill Preferences"` programmatically.
- `src/resources/extensions/gsd/gitignore.ts` line 98 — Generates gitignore comment `"# ── GSD baseline (auto-generated) ──"`.
- `src/resources/GSD-WORKFLOW.md` — Content says "GSD Workflow", "GSD planning methodology", "GSD State", "GSD file types". Filename stays per D077 (internal identifier), but content is user-facing.
- `README.md` — Entire README branded as "GSD 2" with `labrat` npm references. 34 GSD + 5 labrat instances.
- `examples/karpathy-smoke/README.md` — 4 `labrat` references in command examples.
- `src/resources/extensions/gsd/templates/state.md` — Heading `"# GSD State"`.
- `src/resources/extensions/gsd/templates/preferences.md` — Heading `"# GSD Skill Preferences"`.
- `src/resources/extensions/gsd/docs/preferences-reference.md` — ~10 "GSD" references in user-facing documentation.

### Boundary: What MUST NOT change

Per D011 and D077, these are internal identifiers that stay:
- `.gsd/` directory paths (in prompts, templates, and code)
- `/gsd` command names and subcommands (functional routing — S03 adds `/nightshift`)
- `gsd/M001/S01` branch name patterns
- `~/.gsd/agent/extensions/gsd/templates/` file paths
- `src/resources/extensions/gsd/` directory structure
- `@gsd/` workspace imports
- TypeScript type/class names (`GSDState`, `GSDDashboardOverlay`, etc.)
- `GSD-WORKFLOW.md` filename
- Internal code comments (non-user-facing)

## Constraints

- **D011**: Keep `@gsd/*` workspace names and `gsd` extension directory unchanged. Renaming cascades into every import across 5 workspace packages.
- **D077**: User-facing naming only. Replace GSD/labrat in prompts, CLI output, README, examples. Leave internal identifiers alone.
- **D078**: Hypothesis-native terminology (session/hypothesis/experiment) is S03/S04 work, not S01. S01 only changes the product name, not the domain vocabulary.
- **Build verification required**: TypeScript string changes in `guided-flow.ts`, `commands.ts`, `auto.ts`, `index.ts`, `preferences.ts`, `gitignore.ts` require `npm run build` to pass.
- **Test assertions**: Two test files assert GSD-branded strings. `prompt-loader.test.ts` checks `system.md` contains `'GSD'`. `gitignore.test.ts` checks generated content contains `'GSD Skill Preferences'` and `'GSD baseline'`. These must update in sync with the content changes.
- **The `/gsd` command stays**: S01 changes the *description text* of the `/gsd` command but does NOT rename the command itself. S03 will add `/nightshift` as a separate command.

## Common Pitfalls

- **Overzealous replacement** — Blindly replacing all "GSD" would break `.gsd/` paths, `/gsd` commands, and `gsd/` branch patterns. Each replacement must be reviewed in context. Use `\bGSD\b` word-boundary regex but always exclude structural patterns.
- **Missing the ASCII logo** — The `NIGHTSHIFT_LOGO_LINES` array in `index.ts` renders "LABRAT" in box-drawing characters. Easy to overlook because the variable name says NIGHTSHIFT. Either generate a new "NIGHTSHIFT" ASCII art or simplify to remove it since the `titleLine` already shows the brand name in plain text.
- **Template-generated strings** — `preferences.ts` and `gitignore.ts` generate GSD-branded text programmatically. `commands.ts` line 617 generates `"# GSD Skill Preferences"` heading. These are easy to miss because they're string literals in TS, not in .md files.
- **Test breakage** — The two test files asserting GSD strings will fail silently if not updated. Run `npm test` as verification.
- **README npm badges** — The badge URLs reference `labrat` on npmjs.com. If the npm package is now `nightshift`, the badge URLs need updating. But if the package hasn't been published under `nightshift` yet, badges may break — verify badge target.
- **GSD-WORKFLOW.md content vs filename** — The file is loaded by `process.env.NIGHTSHIFT_WORKFLOW_PATH` and referenced in code. Its content says "GSD Workflow" but the filename stays. The content-vs-filename inconsistency is acceptable per D077.

## Open Risks

- **Logo complexity** — Generating "NIGHTSHIFT" ASCII art in the box-drawing style is harder than "LABRAT" (10 chars vs 6). May need to use a simpler font or remove the ASCII art entirely and rely on the text title line.
- **Downstream prompt references** — Other prompts loaded dynamically (via `loadPrompt()`) might reference GSD in interpolated context blocks (e.g., `{{inlinedContext}}` which pulls from STATE.md). Since we're changing the STATE.md template heading, this propagates correctly — but any cached or on-disk `.gsd/STATE.md` files from prior runs will still say "GSD State" until regenerated.
- **README accuracy** — The README describes GSD v1→v2 migration, GSD-2 history, and `/gsd` commands. Changing all "GSD" to "NightShift" may make historical references awkward (e.g., "The original NightShift went viral" — NightShift didn't go viral, GSD did). May need to keep some GSD references as historical proper nouns while making the product identity NightShift. This is an editorial judgment call during execution.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript/Node.js | (core project) | n/a — no external skill needed |
| Markdown prompt files | (plain text editing) | n/a |

No external skills are relevant for this slice — it's a naming/text cleanup task across known file types.

## Sources

- Codebase exploration via `rg`, `find`, and direct file reads (all findings above are from the actual source)
- D011 (M001/S01): Keep internal package naming unchanged
- D077 (M005): User-facing naming only for NightShift cleanup
- D078 (M005): Hypothesis-native terminology convention
- R042: NightShift Naming Consistency requirement definition
