---
estimated_steps: 4
estimated_files: 3
---

# T02: Wire prompt template, CLI --adapt flag, and interactive dispatch

**Slice:** S03 — LLM-Assisted Conflict Adaptation
**Milestone:** M003

## Description

Create the `adapt-upstream.md` prompt template, add `--adapt` CLI flag to `labrat sync`, and wire the interactive dispatch path. The CLI path builds the adaptation prompt from conflict context and prints it (for piping to an LLM or manual use). The interactive path dispatches the prompt via `dispatchWorkflow()` so the LLM autonomously writes adapted files. This makes the mechanical pipeline from T01 usable from both CLI and interactive surfaces.

## Steps

1. Create `src/resources/extensions/gsd/prompts/adapt-upstream.md` with `{{upstreamHash}}`, `{{upstreamSubject}}`, `{{conflictDetails}}`, `{{outputFormat}}` placeholders. Structure: introduction (you are resolving a conflict from upstream cherry-pick), upstream commit context (hash, subject), per-file conflict details (injected as `{{conflictDetails}}`), output format specification (injected as `{{outputFormat}}` — fenced code blocks with `// FILE: path` headers), clear instructions (preserve Labrat additions, apply upstream fix intent, produce complete file contents not patches). Follow `steer-campaign.md` style — structured context, clear task, expected output format.

2. Add `--adapt` to CLI: add `adapt?: boolean` to `CliFlags` interface, parse `--adapt` flag in `parseCliArgs`, update help text. In the apply handler block (lines 217-244): when `result.conflicted && result.conflictContext && cliFlags.adapt`, import `buildAdaptationPrompt` from upstream-sync, call it with the conflict context, print the prompt to stdout (this enables `labrat sync --apply <hash> --adapt | pbcopy` or piping to an LLM CLI), then exit 1. When conflicted without `--adapt`, keep existing behavior (print conflict summary to stderr).

3. Wire interactive dispatch in `commands.ts`: parse `--adapt` from argParts in `handleSync()`. When `result.conflicted && result.conflictContext && hasAdapt`, import `buildAdaptationPrompt` from upstream-sync, assemble the `conflictDetails` and `outputFormat` strings, load `adapt-upstream.md` via `loadPrompt()`, dispatch via the same `pi.sendMessage({ triggerTurn: true })` pattern used in `dispatchWorkflow()` from guided-flow.ts. Include instructions telling the LLM to write adapted files, then call `applyAdaptedFiles()`. Add the adaptation instructions as the workflow task note.

4. Update `/gsd sync` help and tab-completion text to mention `--adapt` flag alongside `--apply`.

## Must-Haves

- [ ] `adapt-upstream.md` template loadable via `loadPrompt('adapt-upstream', vars)` without missing-variable errors
- [ ] `--adapt` flag parsed in CLI, shown in `--help` output
- [ ] CLI conflict path with `--adapt` prints adaptation prompt to stdout
- [ ] Interactive conflict path with `--adapt` dispatches adaptation workflow
- [ ] Template follows existing prompt patterns (context sections, clear task, expected output format)

## Verification

- `npm run build` → compiles clean
- `node dist/cli.js sync --help` → output contains `--adapt`
- Prompt template loads: `node -e "const {loadPrompt} = require('./dist/resources/extensions/gsd/prompt-loader.js'); loadPrompt('adapt-upstream', {upstreamHash:'abc123', upstreamSubject:'fix bug', conflictDetails:'...conflict...', outputFormat:'...format...'})"` → no error

## Observability Impact

- **CLI `--adapt` stdout**: When `labrat sync --apply <hash> --adapt` hits a conflict, the full adaptation prompt is printed to stdout — enables piping to LLM CLIs and debugging prompt content.
- **Interactive dispatch**: `pi.sendMessage` with `customType: "gsd-adapt"` fires the adaptation workflow — visible in session message history.
- **Prompt template**: `loadPrompt('adapt-upstream', vars)` throws descriptive error if any `{{placeholder}}` is missing — surfaces template/code version mismatches.
- **Inspection**: `grep "gsd-adapt" <session-log>` shows adaptation dispatches; `labrat sync --apply <hash> --adapt 2>/dev/null` captures the raw prompt for review.

## Inputs

- `src/resources/extensions/gsd/upstream-sync.ts` — `buildAdaptationPrompt()` from T01
- `src/resources/extensions/gsd/prompt-loader.ts` — `loadPrompt()` for template loading
- `src/resources/extensions/gsd/guided-flow.ts` — `dispatchWorkflow()` pattern (lines 113-125) for interactive dispatch
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — example of structured prompt template with `{{variable}}` placeholders
- `src/cli.ts` — existing `--apply` flag handling as pattern
- `src/resources/extensions/gsd/commands.ts` — existing `handleSync()` with `--apply` parsing

## Expected Output

- `src/resources/extensions/gsd/prompts/adapt-upstream.md` — new prompt template
- `src/cli.ts` — `--adapt` flag added to CliFlags, parseCliArgs, help text, and apply handler
- `src/resources/extensions/gsd/commands.ts` — `handleSync` extended with `--adapt` parsing and adaptation dispatch
