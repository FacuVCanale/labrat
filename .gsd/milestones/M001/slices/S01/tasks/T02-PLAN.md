---
estimated_steps: 9
estimated_files: 10
---

# T02: Apply Labrat identity and rebuild

**Slice:** S01 — Repository Bootstrap & Build
**Milestone:** M001

## Description

Transform the GSD-2 codebase identity to Labrat. This covers package metadata, the piConfig identity chain, env var naming, config directory paths, ASCII logo, and branding text. After all changes, rebuild and verify no stale GSD references remain in env var names.

Workspace package names (`@gsd/*`) and the `gsd` extension directory name stay unchanged — they're internal and renaming cascades into every import for no user-facing benefit (per research).

## Steps

1. Update `package.json`: `name` → `labrat`, `bin` → `{"labrat": "dist/loader.js", "labrat-cli": "dist/loader.js"}`, `description` → research-oriented, `repository`/`homepage`/`bugs` → labrat URLs.
2. Update `pkg/package.json`: `piConfig.name` → `labrat`, `piConfig.configDir` → `.labrat`. Update the package name field.
3. Update `src/app-paths.ts`: change `.gsd` → `.labrat` in all path joins.
4. Rename env vars in `src/loader.ts`: `GSD_CODING_AGENT_DIR` → `LABRAT_CODING_AGENT_DIR`, `GSD_VERSION` → `LABRAT_VERSION`, `GSD_BIN_PATH` → `LABRAT_BIN_PATH`, `GSD_WORKFLOW_PATH` → `LABRAT_WORKFLOW_PATH`, `GSD_BUNDLED_EXTENSION_PATHS` → `LABRAT_BUNDLED_EXTENSION_PATHS`. Update `process.title` → `labrat`. Update banner text from "Get Shit Done" to Labrat branding.
5. Grep all `src/` for `GSD_VERSION`, `GSD_BIN_PATH`, `GSD_WORKFLOW_PATH`, `GSD_BUNDLED_EXTENSION_PATHS`, `GSD_CODING_AGENT_DIR` and update every consumer to the `LABRAT_*` equivalent. Key files: `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/subagent/index.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/guided-flow.ts`.
6. Update `src/logo.ts` with a LABRAT ASCII art logo.
7. Update `src/cli.ts` branding text — version display, any "GSD" user-facing strings.
8. Run `npm run build` and fix any issues.
9. Run verification grep to confirm no stale `GSD_*` env var references remain in `src/`.

## Must-Haves

- [ ] `package.json` name is `labrat` with `labrat` bin entry
- [ ] `piConfig` sets name `labrat` and configDir `.labrat`
- [ ] `app-paths.ts` uses `.labrat` not `.gsd`
- [ ] All 5 `GSD_*` env vars renamed to `LABRAT_*` in loader and all consumers
- [ ] ASCII logo updated for Labrat
- [ ] `npm run build` exits 0
- [ ] No stale `GSD_*` env var references in `src/` (grep verification)

## Verification

- `npm run build` exits 0
- `grep -r 'GSD_VERSION\|GSD_BIN_PATH\|GSD_WORKFLOW_PATH\|GSD_BUNDLED_EXTENSION_PATHS\|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'` returns empty
- `node -e "const p = require('./package.json'); console.assert(p.name === 'labrat'); console.assert(p.bin.labrat); console.log('identity ok')"` prints "identity ok"
- `node -e "const p = require('./pkg/package.json'); console.assert(p.piConfig.name === 'labrat'); console.assert(p.piConfig.configDir === '.labrat'); console.log('piConfig ok')"` prints "piConfig ok"
- `grep '.labrat' src/app-paths.ts` shows the updated path

## Observability Impact

- **Env var names changed:** All runtime env vars shift from `GSD_*` to `LABRAT_*`. A future agent diagnosing env issues should grep for `LABRAT_VERSION`, `LABRAT_BIN_PATH`, `LABRAT_WORKFLOW_PATH`, `LABRAT_BUNDLED_EXTENSION_PATHS`, `LABRAT_CODING_AGENT_DIR`.
- **Config directory moved:** App data moves from `~/.gsd/` to `~/.labrat/`. Inspect `~/.labrat/agent/`, `~/.labrat/sessions/` for runtime state.
- **CLI branding:** `--version` prints `LABRAT_VERSION` value. `--help` shows `labrat` usage. Error prefixes use `[labrat]`.
- **Verification grep:** `grep -r 'GSD_VERSION\|GSD_BIN_PATH\|GSD_WORKFLOW_PATH\|GSD_BUNDLED_EXTENSION_PATHS\|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'` should return empty — any output means a stale reference was missed.

## Inputs

- T01 completed: GSD-2 source merged and building successfully
- Research findings on identity touchpoints (S01-RESEARCH.md)

## Expected Output

- All identity files updated with Labrat branding
- Clean build in `dist/`
- Commit: `feat(S01): apply Labrat identity to GSD-2 codebase`
