# S01: Change Detection, Categorization & Sync Report — UAT

**Milestone:** M003
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed (artifact-driven + live-runtime)
- Why this mode is sufficient: Classification accuracy is verifiable by inspecting report output against known commit history. State persistence and CLI behavior require live runtime. No human-experience judgment needed — correctness is objective.

## Preconditions

- Repository has `upstream` remote pointing to GSD-2 (`git remote -v | grep upstream`)
- `npm run build` has been run (dist/cli.js exists)
- `.gsd/UPSTREAM-SYNC.json` does NOT exist (delete if present: `rm -f .gsd/UPSTREAM-SYNC.json`)
- Network access available for `git fetch upstream` (or use `--no-fetch` if already fetched)

## Smoke Test

1. Run `node dist/cli.js sync --no-fetch`
2. **Expected:** Categorized report prints to stdout showing infrastructure, mixed, and development-specific sections with commit hashes and subjects. Exit code 0.

## Test Cases

### 1. First sync produces categorized report

1. Delete `.gsd/UPSTREAM-SYNC.json` if it exists
2. Run `node dist/cli.js sync --no-fetch`
3. **Expected:** Report contains three sections: "Infrastructure" (largest group), "Mixed", and "Development-specific". Each commit shows hash (short), subject, author, and date. Infrastructure section contains 400+ commits. Summary line shows counts for each category.

### 2. Second sync shows no new commits

1. Run `node dist/cli.js sync --no-fetch` (immediately after test 1)
2. **Expected:** Output says "No new upstream commits to evaluate." — all commits were persisted as evaluated in the first run.

### 3. State file persists across invocations

1. Run `cat .gsd/UPSTREAM-SYNC.json | python3 -m json.tool` (or `jq .` if available)
2. **Expected:** Valid JSON with fields: `lastFetchedUpstream` (40-char hex hash), `evaluatedCommits` (array of 500+ hashes), `appliedCommits` (empty array), `version` (1).

### 4. --include-evaluated re-shows all commits

1. Run `node dist/cli.js sync --no-fetch --include-evaluated`
2. **Expected:** Full categorized report prints again (same as test 1), despite all commits being already evaluated.

### 5. --help prints usage

1. Run `node dist/cli.js sync --help`
2. **Expected:** Usage text showing `--no-fetch`, `--include-evaluated`, and `--help` flags with descriptions. Exit code 0.

### 6. Classification accuracy — known infrastructure commits

1. In the report from test 1 or 4, search for commits touching only `packages/*` files
2. **Expected:** All such commits appear in the "Infrastructure" section, not "Development-specific"

### 7. Classification accuracy — known development-specific commits

1. In the report, search for commits that only touch known Labrat-added files (e.g., steering.ts, agenda.ts, eval-runner.ts, simplicity-scorer.ts)
2. **Expected:** Such commits appear in the "Development-specific" section

### 8. Conflict markers on overlapping files

1. In the report, look for commits that touch files also modified by Labrat (e.g., auto.ts, types.ts)
2. **Expected:** These commits show `⚠ conflicts:` marker with the list of overlapping file names (note: may show empty if no merge-base exists — this is expected graceful degradation)

## Edge Cases

### Malformed state file degradation

1. Run `echo '{bad json!!!' > .gsd/UPSTREAM-SYNC.json`
2. Run `node dist/cli.js sync --no-fetch 2>/tmp/sync-stderr.txt`
3. **Expected:** Report prints normally (as if fresh state). Check `/tmp/sync-stderr.txt` — contains `[upstream-sync]` warning about corrupt state file.
4. Clean up: verify `.gsd/UPSTREAM-SYNC.json` is now valid JSON (overwritten with fresh state after the run)

### Missing upstream remote

1. In a repo without the `upstream` remote (or rename it temporarily: `git remote rename upstream upstream-bak`)
2. Run `node dist/cli.js sync`
3. **Expected:** stderr warning about fetch failure. Report may show 0 commits or degrade gracefully. Exit code 0 (not a crash).
4. Clean up: `git remote rename upstream-bak upstream`

### Empty .gsd directory

1. Create a fresh temp directory: `mkdir -p /tmp/test-empty/.gsd`
2. Run from that directory (note: this tests readSyncState only, not the full CLI)
3. **Expected:** `readSyncState('/tmp/test-empty')` returns `{ lastFetchedUpstream: '', evaluatedCommits: [], appliedCommits: [], version: 1 }`

## Failure Signals

- `labrat sync` crashes with a stack trace instead of printing a report
- Report shows 0 infrastructure commits (should be 400+)
- Second run still shows commits (state not persisting)
- `--include-evaluated` shows different count than first run (commits lost during persistence)
- `.gsd/UPSTREAM-SYNC.json` contains invalid JSON after a successful run
- Any import from auto.ts, eval-runner.ts, or campaign lifecycle in upstream-sync.ts (`grep -c "from.*auto\|from.*eval-runner\|from.*campaign" src/resources/extensions/gsd/upstream-sync.ts` should be 0)

## Requirements Proved By This UAT

- R026 (GSD-2 Upstream Feature Sync) — partially proved: detection, categorization, and reporting layer works. Sync state persists. Not yet proved: selective apply, LLM conflict adaptation.

## Not Proven By This UAT

- Selective cherry-pick application (`labrat sync --apply <commit>`) — S02
- Build/test verification after apply — S02
- LLM-assisted conflict resolution — S03
- Conflict detection accuracy for repos with shared history (current repo has unrelated histories, so conflict predictions are empty)

## Notes for Tester

- The commit counts (467 infra, 14 dev, 51 mixed) are based on 532 upstream commits at the time of development. If upstream has new commits since, the total and category counts will increase.
- `--no-fetch` is recommended for testing to avoid network dependency and keep results deterministic.
- Conflict markers may show empty sets due to unrelated histories — this is expected and documented as a known limitation. The feature works correctly with related histories (proven by contract tests with synthetic repos).
