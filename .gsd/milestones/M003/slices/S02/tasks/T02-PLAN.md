---
estimated_steps: 5
estimated_files: 2
---

# T02: Wire --apply flag into CLI and interactive command

**Slice:** S02 — Selective Apply & Build Verification
**Milestone:** M003

## Description

Wire the `--apply <hash>` flag into the `labrat sync` CLI subcommand and the `/gsd sync` interactive command so users can trigger `applyUpstreamCommit()` from the terminal. Follows existing sync handler patterns — dynamic import, fetch-then-apply, structured output to stdout.

## Steps

1. Add `applyHash?: string` to the `CliFlags` interface in cli.ts. Add `--apply <hash>` parsing in `parseCliArgs()` — same pattern as `--model <value>`.

2. Update the sync help text in cli.ts to include `--apply <hash>` option with description: "Cherry-pick a specific upstream commit and verify build+tests".

3. Add apply handler branch in the sync CLI block (before the report path): if `cliFlags.applyHash` is set, import `applyUpstreamCommit` from upstream-sync.ts, call it with basePath and hash, print structured result (success message with commit details, or conflict report with file list, or error), then `process.exit(0/1)`.

4. Extend the `/gsd sync` interactive handler in commands.ts to accept `--apply <hash>` argument — parse args from the command string, if `--apply` present call `applyUpstreamCommit()` and notify with result.

5. Build and verify: `npm run build`, `node dist/cli.js sync --help` shows --apply flag.

## Must-Haves

- [ ] `--apply <hash>` flag parsed in CLI
- [ ] Sync handler branches to apply path when flag is present
- [ ] Apply result printed to stdout with appropriate formatting (success/conflict/error)
- [ ] Help text updated with --apply documentation
- [ ] Interactive `/gsd sync --apply <hash>` works
- [ ] Build compiles clean

## Verification

- `npm run build` → compiles clean
- `node dist/cli.js sync --help` → shows `--apply <hash>` in options
- `npx tsx src/resources/extensions/gsd/tests/upstream-sync.test.ts` → still all green (no regressions)

## Inputs

- `src/resources/extensions/gsd/upstream-sync.ts` — T01's `applyUpstreamCommit` function
- `src/cli.ts` — existing sync handler block (lines 197–263)
- `src/resources/extensions/gsd/commands.ts` — existing `handleSync` function (lines 367–407)

## Expected Output

- `src/cli.ts` — with `applyHash` in CliFlags, flag parsing, apply handler branch, updated help text
- `src/resources/extensions/gsd/commands.ts` — with `--apply` argument handling in `handleSync`

## Observability Impact

- **CLI stdout/stderr**: `labrat sync --apply <hash>` prints structured result — success with build/test status, conflict with file list, or error message. Exit code 0 on success, 1 on failure.
- **Interactive notify**: `/gsd sync --apply <hash>` surfaces the same structured result via `ctx.ui.notify()` — info level for success, warning for conflict/error.
- **State file**: After successful apply, `cat .gsd/UPSTREAM-SYNC.json` shows the hash in `appliedCommits` array (written by `applyUpstreamCommit`).
- **Failure inspection**: On conflict, stderr includes per-file conflict list. On verify failure, stderr includes build/test pass status. `ApplyResult` fields are fully surfaced.
