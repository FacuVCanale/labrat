# S01: Repository Bootstrap & Build — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice produces build artifacts and configuration changes — all verifiable via CLI commands and file inspection without a running server or UI.

## Preconditions

- Repository cloned with all dependencies installed (`npm install --ignore-scripts`)
- Node.js available (version compatible with GSD-2 — check `engines` in package.json)
- On the `gsd/M001/S01` branch (or its merge target)

## Smoke Test

Run `npm run build` — should exit 0 with no errors. This confirms the entire codebase compiles.

## Test Cases

### 1. Build passes clean

1. Run `npm run build`
2. **Expected:** Exit code 0, no TypeScript errors in output
3. Run `ls dist/loader.js`
4. **Expected:** File exists — build output was produced

### 2. Package identity is labrat

1. Run `node -e "const p = require('./package.json'); console.log(p.name, Object.keys(p.bin).join(','))"`
2. **Expected:** Output is `labrat labrat,labrat-cli`
3. Run `node -e "const p = require('./package.json'); console.log(p.description)"`
4. **Expected:** Description mentions research/experiments, not "development" or "GSD"

### 3. piConfig identity is labrat

1. Run `node -e "const p = require('./pkg/package.json'); console.log(p.piConfig.name, p.piConfig.configDir)"`
2. **Expected:** Output is `labrat .labrat`

### 4. Config directory points to ~/.labrat

1. Run `grep 'appRoot' src/app-paths.ts`
2. **Expected:** Line contains `.labrat`, not `.gsd`
3. Run `grep -c '\.gsd' src/app-paths.ts`
4. **Expected:** 0 — no references to `.gsd` in app-paths

### 5. No stale GSD_* env var references

1. Run `grep -r 'GSD_VERSION\|GSD_BIN_PATH\|GSD_WORKFLOW_PATH\|GSD_BUNDLED_EXTENSION_PATHS\|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'`
2. **Expected:** Empty output — no stale references. Exit code 1 (grep found nothing).

### 6. LABRAT_* env vars exist in loader

1. Run `grep -c 'LABRAT_' src/loader.ts`
2. **Expected:** At least 5 matches (LABRAT_VERSION, LABRAT_BIN_PATH, LABRAT_WORKFLOW_PATH, LABRAT_BUNDLED_EXTENSION_PATHS, LABRAT_CODING_AGENT_DIR)

### 7. Upstream remote preserved

1. Run `git remote -v | grep upstream`
2. **Expected:** Shows upstream remote URL pointing to GSD-2 repository
3. Run `git merge-base --is-ancestor upstream/main HEAD; echo $?`
4. **Expected:** Exit code 0 — upstream main is an ancestor of current HEAD

### 8. Native bindings present

1. Run `npm ls @gsd-build/engine-linux-x64-gnu 2>/dev/null | grep engine`
2. **Expected:** Shows `@gsd-build/engine-linux-x64-gnu@2.10.5` (or compatible version)

### 9. Workspace packages build

1. Run `npm run build 2>&1 | grep -E 'packages/(native|pi-tui|pi-ai|pi-agent-core|pi-coding-agent)'`
2. **Expected:** Build output shows all 5 workspace packages being compiled

## Edge Cases

### Internal @gsd/* names preserved

1. Run `grep '"@gsd/' package.json | head -5`
2. **Expected:** Workspace dependencies still use `@gsd/*` naming — these are internal and intentionally unchanged (D011)

### Extension directory name unchanged

1. Run `ls src/resources/extensions/gsd/`
2. **Expected:** Directory exists with index.ts, commands.ts, guided-flow.ts — the `gsd` extension directory name is preserved intentionally

### Logo updated

1. Run `grep -c 'LABRAT\|labrat' src/logo.ts`
2. **Expected:** Multiple matches — ASCII art contains LABRAT branding
3. Run `grep -c 'GSD\|gsd' src/logo.ts | head -1`
4. **Expected:** 0 or only in comments — no GSD branding in the logo

## Failure Signals

- `npm run build` exits non-zero — build is broken, nothing else matters
- `grep` for stale `GSD_*` env vars returns results — incomplete identity transformation
- `dist/loader.js` doesn't exist — build output missing
- `package.json` name is not `labrat` — identity not applied
- `src/app-paths.ts` references `.gsd` — config path not updated
- `upstream` remote missing — can't cherry-pick from GSD-2

## Requirements Proved By This UAT

- R001 — GSD-2 base merged, upstream tracked, builds and runs. Tests 1, 7, 8, 9 prove this.
- R015 — Full LLM provider support inherited. Test 9 (workspace packages build) confirms the provider infrastructure compiles. No providers were removed or modified.

## Not Proven By This UAT

- R015 runtime verification — we prove the LLM provider code compiles but don't test actual API calls to any provider. That's appropriate for a bootstrap slice; runtime provider testing happens when experiments actually run in S03+.
- No runtime execution of `labrat` command — this slice proves build and identity, not runtime behavior.

## Notes for Tester

- The `npm install --ignore-scripts` flag is important — the postinstall script prompts interactively and will hang in automation.
- Internal `@gsd/*` package names are intentional per D011 — don't report these as bugs.
- The `gsd` extension directory name is also intentionally preserved — it's internal plumbing, not user-facing.
- If testing on a non-Linux platform, the native binding package name will differ (e.g., `engine-darwin-arm64` on Apple Silicon).
