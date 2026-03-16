---
estimated_steps: 3
estimated_files: 2
---

# T02: Rename GSD/labrat in README and examples, run final verification

**Slice:** S01 — NightShift Naming Cleanup
**Milestone:** M005

## Description

README.md and examples are the user's first contact with the product. This task updates all user-facing documentation to say NightShift/nightshift, then runs a comprehensive verification grep across the entire user-facing surface to prove R042 completeness. Historical references to "GSD" as a predecessor project name may be kept where appropriate (e.g., "Built on GSD-2") — the goal is consistent product identity, not erasing history.

## Steps

1. **Update README.md** — Rename product identity from "GSD 2" / "GSD" to "NightShift" throughout. Change npm package references from `labrat` to `nightshift`. Change badge URLs if applicable. For historical context (e.g., "The original GSD went viral"), keep "GSD" as a proper noun referring to the predecessor but make clear the current product is NightShift. Maintain accurate descriptions of `/gsd` commands (the command name stays, per D077).

2. **Update examples** — `examples/karpathy-smoke/README.md`: change `labrat` → `nightshift` in all command examples (4 instances).

3. **Final comprehensive verification** — Run `rg -in '\bGSD\b' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ src/resources/extensions/gsd/guided-flow.ts src/resources/extensions/gsd/commands.ts src/resources/extensions/gsd/auto.ts src/resources/extensions/gsd/index.ts src/resources/extensions/gsd/preferences.ts src/resources/extensions/gsd/gitignore.ts README.md examples/` and categorize every remaining hit as either (a) internal identifier that must stay, or (b) missed user-facing reference that needs fixing. Run `rg -in '\blabrat\b|\bLabrat\b' README.md examples/ src/resources/extensions/gsd/` — must be zero hits. Run `npm run build && npm test` one final time.

## Must-Haves

- [ ] README.md product name is NightShift throughout (except historical predecessor refs)
- [ ] All `labrat` references in README and examples changed to `nightshift`
- [ ] Final grep confirms zero unintentional GSD/labrat in user-facing surfaces
- [ ] `npm run build && npm test` passes

## Verification

- `rg -iw 'labrat' README.md examples/` — zero hits
- `rg -w 'GSD' README.md` — only historical/predecessor references, zero product-name references
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — zero hits (confirmed from T01)
- `npm run build && npm test` — passes

## Inputs

- T01 completed — all source code and prompt branding already says NightShift
- S01-RESEARCH.md — README has ~34 GSD + 5 labrat instances, examples has 4 labrat instances

## Observability Impact

- **Signals changed:** README.md and examples now show NightShift branding — no new runtime signals, but documentation is the primary user-facing discovery surface.
- **Future inspection:** `rg -iw 'labrat' README.md examples/` — zero hits confirms npm package name rename. `rg -w 'GSD' README.md` — only historical predecessor references remain.
- **Failure visibility:** If a user-facing GSD/labrat reference leaks through, `rg -in '\bGSD\b|\blabrat\b' README.md examples/` catches it immediately. `npm run build && npm test` catches any TS breakage from string changes.

## Expected Output

- `README.md` with consistent NightShift branding
- `examples/karpathy-smoke/README.md` with nightshift commands
- Verification log proving zero user-facing GSD/labrat leaks (R042 satisfied)
