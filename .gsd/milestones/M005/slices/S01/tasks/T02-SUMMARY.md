---
id: T02
parent: S01
milestone: M005
provides:
  - README.md with consistent NightShift product branding (title, npm package, descriptions)
  - examples/karpathy-smoke/README.md with nightshift command references
  - Verification log proving zero user-facing GSD/labrat leaks (R042 satisfied)
key_files:
  - README.md
  - examples/karpathy-smoke/README.md
key_decisions:
  - "Historical GSD references kept as predecessor proper nouns (3 instances: 'The original GSD went viral', 'The original GSD was a collection', 'The original GSD showed what was possible')"
  - "GitHub repo URLs (gsd-build/GSD-2) kept as-is — they point to the real repository"
  - "Architecture tree code comments ('GSD env vars', 'Core GSD extension', 'GSD-WORKFLOW.md') kept as internal identifiers"
patterns_established:
  - "README GSD classification: 7 remaining hits all categorized as historical/internal — zero product-name branding for current product"
observability_surfaces:
  - "rg -iw 'labrat' README.md examples/ — zero hits confirms npm package name rename"
  - "rg -w 'GSD' README.md — only 7 hits, all historical predecessor refs or internal identifiers"
  - "rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ — zero hits"
duration: 12min
verification_result: passed
completed_at: 2026-03-16T04:37:00Z
blocker_discovered: false
---

# T02: Rename GSD/labrat in README and examples, run final verification

**Renamed all user-facing GSD/labrat branding to NightShift in README.md and examples, verified zero leaks across entire user-facing surface — R042 complete.**

## What Happened

Updated README.md: changed product title from "GSD 2" to "NightShift", replaced all 5 `labrat` npm package references with `nightshift`, renamed ~25 product-name GSD references to NightShift (descriptions, section headers, feature explanations). Preserved 7 GSD references that are either historical predecessor proper nouns ("The original GSD went viral"), GitHub repository URLs (gsd-build/GSD-2), or internal architecture identifiers (env vars, file paths, GSD-WORKFLOW.md filename).

Updated examples/karpathy-smoke/README.md: replaced 4 `labrat` references with `nightshift` (command examples, CLI description).

Ran comprehensive verification across entire user-facing surface confirming zero unintentional GSD/labrat leaks.

## Verification

- `npm run build` — passes clean (zero errors)
- `npm test` — all 726 tests pass, 0 failures
- `rg -iw 'labrat' README.md examples/` — **0 hits** (all labrat references replaced)
- `rg -iw 'labrat' src/resources/extensions/gsd/` — **0 hits** (confirmed from T01)
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` — **0 hits** (confirmed from T01)
- `rg -w 'GSD' examples/` — **0 hits**
- `rg -w 'GSD' README.md` — **7 hits**, all categorized:
  - Line 9: GitHub repo URL `gsd-build/GSD-2` (external URL, keep)
  - Line 12: "The original GSD went viral" (historical predecessor, keep)
  - Line 26: "The original GSD was a collection" (historical predecessor, keep)
  - Line 370: "GSD env vars" (architecture diagram, internal identifier)
  - Line 377: "extensions/gsd/" (filesystem path, internal identifier)
  - Line 381: "GSD-WORKFLOW.md" (filename, per D077)
  - Line 461: "The original GSD showed what was possible" (historical predecessor, keep)
- `grep -c 'NightShift' src/resources/extensions/gsd/prompts/system.md` — **4** (≥1 required)
- Boundary check: `rg '\.gsd/' src/resources/extensions/gsd/index.ts | grep -i nightshift` — **0 hits** (no .gsd/ paths accidentally renamed)
- Failure-path check: `npm test 2>&1 | grep -c 'FAIL'` — **0**

### Slice-level verification (final task — all must pass):
- ✅ `npm run build` — passes
- ✅ `npm test` — 726 pass, 0 fail
- ✅ `rg -w 'GSD' prompts/templates/docs/README/examples` — zero user-facing branding hits (7 README hits all historical/internal)
- ✅ `rg -iw 'labrat' README.md examples/ src/resources/extensions/gsd/index.ts` — zero hits
- ✅ Spot-check: system.md has 4 NightShift references
- ✅ Boundary check: no .gsd/ paths renamed to nightshift
- ✅ Failure-path check: 0 FAIL in test output

## Diagnostics

- Inspect README branding: `rg -n -w 'GSD' README.md` — should show only 7 historical/internal hits
- Inspect labrat cleanup: `rg -rn 'labrat' README.md examples/` — should be zero
- Full surface audit: `rg -in '\bGSD\b|\blabrat\b' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/ README.md examples/` — should show only 7 README hits

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `README.md` — Product title "GSD 2" → "NightShift", 5 `labrat` → `nightshift` npm refs, ~25 product-name GSD → NightShift
- `examples/karpathy-smoke/README.md` — 4 `labrat` → `nightshift` in command examples
- `.gsd/milestones/M005/slices/S01/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
