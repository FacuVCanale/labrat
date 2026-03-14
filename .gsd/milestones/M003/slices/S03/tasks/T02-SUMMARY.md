---
id: T02
parent: S03
milestone: M003
provides:
  - adapt-upstream.md prompt template for LLM conflict resolution
  - --adapt CLI flag on labrat sync --apply for prompt piping
  - Interactive /gsd sync --apply --adapt dispatch via pi.sendMessage
key_files:
  - src/resources/extensions/gsd/prompts/adapt-upstream.md
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
key_decisions: []
patterns_established:
  - Interactive dispatch uses customType "gsd-adapt" (distinct from "gsd-run", "gsd-doctor-heal", "gsd-steer")
  - CLI --adapt prints raw prompt to stdout for piping (labrat sync --apply <hash> --adapt | pbcopy)
observability_surfaces:
  - CLI --adapt prints full adaptation prompt to stdout — pipe to file/clipboard for inspection
  - Interactive dispatch fires pi.sendMessage with customType "gsd-adapt" — visible in session message history
  - loadPrompt('adapt-upstream', vars) throws descriptive error if any {{placeholder}} is missing
duration: 12m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Wire prompt template, CLI --adapt flag, and interactive dispatch

**Created adapt-upstream.md prompt template, added --adapt CLI flag to labrat sync, and wired interactive dispatch path via pi.sendMessage with customType "gsd-adapt".**

## What Happened

Created `adapt-upstream.md` prompt template with four `{{variable}}` placeholders: `upstreamHash`, `upstreamSubject`, `conflictDetails`, `outputFormat`. Template follows steer-campaign.md structure — context sections, clear task instructions, output format specification. Instructions emphasize preserving Labrat additions while applying upstream fix intent.

Added `adapt?: boolean` to `CliFlags` interface in cli.ts, `--adapt` flag parsing in `parseCliArgs`, and help text in the sync subcommand help block. In the apply handler, when `result.conflicted && result.conflictContext && cliFlags.adapt`, calls `buildAdaptationPrompt()` and prints the result to stdout — enables `labrat sync --apply <hash> --adapt | pbcopy` or piping to an LLM CLI. Without `--adapt`, existing conflict behavior (stderr summary) is preserved.

Wired interactive dispatch in commands.ts: `handleSync` now accepts `pi` parameter, parses `--adapt` from argParts. On conflict with `--adapt`, loads the `adapt-upstream.md` template via `loadPrompt()`, assembles conflict details and output format strings from `ConflictContext`, and dispatches via `pi.sendMessage({ customType: "gsd-adapt", content: taskNote, display: false }, { triggerTurn: true })`. The task note includes the full prompt plus workflow instructions for the LLM to write adapted files and call `applyAdaptedFiles()`.

Added sync-specific tab completion for `--apply`, `--adapt`, `--no-fetch`, `--include-evaluated` flags.

## Verification

- `npm run build` → compiles clean ✅
- `node dist/cli.js sync --help` → shows `--adapt` in options ✅
- `npx tsx -e "import { loadPrompt } from './src/resources/extensions/gsd/prompt-loader.ts'; loadPrompt('adapt-upstream', {upstreamHash:'abc123', upstreamSubject:'fix bug', conflictDetails:'...', outputFormat:'...'})"` → loads without error, returns 1292 chars ✅
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 167 passed, 0 failed ✅
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts` → 0 (D055) ✅
- Slice verification: all checks pass ✅

## Diagnostics

- `labrat sync --apply <hash> --adapt 2>/dev/null` — captures raw adaptation prompt for review
- `grep "gsd-adapt" <session-log>` — shows adaptation dispatches in interactive mode
- `loadPrompt('adapt-upstream', {})` throws with missing variable names — surfaces template/code mismatches

## Deviations

- Task plan verification command used `require('./dist/...')` but prompt-loader.ts is ESM and excluded from tsc compilation (src/resources/ is in tsconfig exclude). Verified via `npx tsx` import from source instead — this is the correct runtime mechanism since extensions are loaded from source .ts files.
- `handleSync` signature changed to accept `pi: ExtensionAPI` parameter (was not receiving it before) — needed for interactive dispatch.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/adapt-upstream.md` — New prompt template with {{upstreamHash}}, {{upstreamSubject}}, {{conflictDetails}}, {{outputFormat}} placeholders
- `src/cli.ts` — Added `adapt?: boolean` to CliFlags, `--adapt` parsing in parseCliArgs, help text, and conflict handler that prints adaptation prompt to stdout
- `src/resources/extensions/gsd/commands.ts` — Extended handleSync with `pi` parameter, `--adapt` parsing, adaptation workflow dispatch, and sync tab-completion
- `.gsd/milestones/M003/slices/S03/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
