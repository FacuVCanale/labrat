---
id: S03
parent: M003
milestone: M003
provides:
  - buildAdaptationPrompt() pure function for conflict-to-prompt assembly
  - parseAdaptedFiles() LLM output parser with multi-format header detection
  - applyAdaptedFiles() file writer + commit + verify + revert pipeline
  - AdaptedFile type exported from types.ts
  - adapt-upstream.md prompt template with {{variable}} placeholders
  - --adapt CLI flag on labrat sync --apply for prompt piping
  - Interactive /gsd sync --apply --adapt dispatch via pi.sendMessage (customType "gsd-adapt")
requires:
  - slice: S01
    provides: readSyncState/writeSyncState, fetchUpstreamCommits, categorizeCommit, SyncState type
  - slice: S02
    provides: ConflictContext/ConflictFileInfo types, verifyAfterApply, getConflictContext, applyUpstreamCommit pattern
affects: []
key_files:
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/upstream-sync.ts
  - src/resources/extensions/gsd/tests/upstream-sync.test.ts
  - src/resources/extensions/gsd/prompts/adapt-upstream.md
  - src/cli.ts
  - src/resources/extensions/gsd/commands.ts
key_decisions:
  - D060 — Parse FILE headers support three variants (// FILE:, ## FILE:, **FILE:**) for robustness against LLM format drift
  - D061 — Commit message format upstream-adapt(<short-hash>) distinguishes adapted from clean cherry-picks in git log
  - D059 — Git commit via stdin (-F -) reused for adapted commits (same pattern as S02)
patterns_established:
  - extractFilePath private helper for multi-format header detection in LLM output
  - Adaptation pipeline mirrors cherry-pick pipeline (validate → write → commit → verify → revert/succeed)
  - Interactive dispatch uses customType "gsd-adapt" (distinct from "gsd-run", "gsd-doctor-heal", "gsd-steer")
  - CLI --adapt prints raw prompt to stdout for piping (labrat sync --apply <hash> --adapt | pbcopy)
observability_surfaces:
  - ApplyResult returned by applyAdaptedFiles — same structure as applyUpstreamCommit
  - readSyncState(basePath).appliedCommits includes adapted commit hashes
  - git log --grep="upstream-adapt" shows adapted commits
  - CLI --adapt prints full adaptation prompt to stdout for inspection
  - Interactive dispatch fires pi.sendMessage with customType "gsd-adapt" — visible in session history
  - loadPrompt('adapt-upstream', {}) throws descriptive error if any placeholder is missing
drill_down_paths:
  - .gsd/milestones/M003/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S03/tasks/T02-SUMMARY.md
duration: 27m
verification_result: passed
completed_at: 2026-03-14
---

# S03: LLM-Assisted Conflict Adaptation

**Complete LLM adaptation pipeline for upstream sync conflicts — prompt construction, output parsing, file application with verify/revert, CLI --adapt flag, interactive dispatch, and prompt template — all proven by 54 contract tests.**

## What Happened

T01 added the three core adaptation functions. `buildAdaptationPrompt(context, labratSummary?)` is a pure function that assembles a structured prompt from a `ConflictContext` — includes upstream commit intent (hash + subject), per-file conflict details (merge markers, Labrat version, upstream patch in fenced blocks), optional project summary, and output format specification with `// FILE: <path>` header convention. `parseAdaptedFiles(llmOutput)` extracts `AdaptedFile[]` from fenced code blocks, handling varied fence styles (```ts, ```typescript), extra prose between blocks, missing trailing fences, and three header formats (`// FILE:`, `## FILE:`, `**FILE:**`). `applyAdaptedFiles(basePath, hash, subject, adaptedFiles)` writes files, stages, commits with `upstream-adapt(<short-hash>): <subject>`, runs `verifyAfterApply()`, reverts on failure, and updates sync state on success. Every exit path leaves the repo clean. Added `AdaptedFile` type to types.ts.

T02 wired the pipeline to user-facing surfaces. Created `adapt-upstream.md` prompt template with four `{{variable}}` placeholders (upstreamHash, upstreamSubject, conflictDetails, outputFormat). Added `--adapt` CLI flag to `labrat sync` — when `--apply <hash> --adapt` is used and a conflict is detected, prints the full adaptation prompt to stdout for piping. Wired interactive dispatch in commands.ts — on conflict with `--adapt`, loads the template via `loadPrompt()` and dispatches via `pi.sendMessage({ customType: "gsd-adapt" })`. Added sync-specific tab completion for all flags.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → 167 passed, 0 failed (113 S01+S02 + 54 S03)
- `npm run build` → compiles clean
- `node dist/cli.js sync --help` → shows `--adapt` in options
- `grep -c "^import.*from.*auto\|^import.*from.*eval-runner" src/resources/extensions/gsd/upstream-sync.ts` → 0 (D055)
- `loadPrompt('adapt-upstream', {upstreamHash:'abc123', upstreamSubject:'fix bug', conflictDetails:'...', outputFormat:'...'})` → loads without error (1272 chars)

## Requirements Advanced

- R026 — Fully validated: LLM adaptation pipeline completes the upstream sync capability. Prompt construction, output parsing, file application with verify/revert, CLI flag, interactive dispatch all operational.

## Requirements Validated

- R026 — GSD-2 Upstream Feature Sync: S01 fetches/categorizes/reports 532 upstream commits with persistent state. S02 selectively applies commits with conflict detection and build verification. S03 dispatches conflicts to LLM for adapted patches with verify/revert. Full pipeline proven: identify → categorize → apply → adapt → verify.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- T02 prompt template verification used `npx tsx` import from source instead of `require('./dist/...')` — prompt-loader.ts is ESM and excluded from tsc compilation (src/resources/ is in tsconfig exclude). This is the correct runtime mechanism since extensions are loaded from source .ts files.
- T02 added `pi: ExtensionAPI` parameter to `handleSync` signature — needed for interactive dispatch, was not receiving it before.

## Known Limitations

- LLM adaptation quality is proven mechanically (prompt construction, output parsing, file writing) but not with a real LLM call — the contract tests verify the pipeline, not the LLM's ability to produce correct adapted code. Real adaptation quality is validated at integration/UAT time.
- `--adapt` in CLI mode prints the prompt to stdout for piping — it does not call an LLM directly. Interactive mode dispatches to the session's LLM.

## Follow-ups

- none — S03 completes M003.

## Files Created/Modified

- `src/resources/extensions/gsd/types.ts` — Added `AdaptedFile` interface after `ApplyResult`
- `src/resources/extensions/gsd/upstream-sync.ts` — Added `buildAdaptationPrompt`, `parseAdaptedFiles`, `applyAdaptedFiles` exports + `extractFilePath` private helper
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` — Added S03 test section with 54 assertions
- `src/resources/extensions/gsd/prompts/adapt-upstream.md` — New prompt template with 4 placeholders
- `src/cli.ts` — Added `adapt?: boolean` to CliFlags, `--adapt` flag parsing, help text, conflict handler
- `src/resources/extensions/gsd/commands.ts` — Extended handleSync with `pi` parameter, `--adapt` parsing, adaptation dispatch, tab completion

## Forward Intelligence

### What the next slice should know
- M003 is complete — there is no next slice in this milestone. The upstream sync pipeline is fully operational from fetch through LLM-assisted adaptation.

### What's fragile
- `parseAdaptedFiles` handles three header formats but LLMs may invent new ones — the `extractFilePath` helper is the single point to extend if new formats appear
- Interactive adaptation dispatch relies on `pi.sendMessage` with `customType: "gsd-adapt"` — this requires the session to have an active LLM context

### Authoritative diagnostics
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` — 167 total assertions, authoritative for all upstream-sync functionality
- `git log --grep="upstream-adapt"` — shows all commits made by the adaptation pipeline
- `readSyncState(basePath).appliedCommits` — single source of truth for applied upstream commits

### What assumptions changed
- Assumed prompt template would follow steer-campaign.md structure — confirmed, works cleanly
- Assumed `handleSync` would need `pi` parameter for interactive dispatch — confirmed, required signature change
