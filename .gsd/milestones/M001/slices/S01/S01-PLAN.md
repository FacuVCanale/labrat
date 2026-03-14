# S01: Repository Bootstrap & Build

**Goal:** GSD-2 codebase merged into labrat repo, identity updated to Labrat, `npm run build` passes.
**Demo:** `npm run build` succeeds. `node dist/loader.js --version` shows "labrat". Environment references `.labrat` not `.gsd` for app config.

## Must-Haves

- GSD-2 v2.10.6 source merged into labrat repo via `--allow-unrelated-histories`
- `npm run build` passes clean
- Package identity is `labrat` (name, bin, description in package.json)
- `piConfig` in `pkg/package.json` sets `name: "labrat"`, `configDir: ".labrat"`
- `app-paths.ts` references `~/.labrat` not `~/.gsd`
- All `GSD_*` env vars in `loader.ts` renamed to `LABRAT_*`
- `GSD_*` env var consumers in extensions updated to match
- Upstream remote preserved for future cherry-picks
- Workspace package names (`@gsd/*`) left unchanged (internal, not published)

## Verification

- `npm run build` exits 0
- `grep -r 'GSD_VERSION\|GSD_BIN_PATH\|GSD_WORKFLOW_PATH\|GSD_BUNDLED_EXTENSION_PATHS\|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'` returns empty (no stale env var references)
- `node -e "const p = require('./package.json'); console.assert(p.name === 'labrat'); console.assert(p.bin.labrat); console.log('ok')"` prints ok
- `node -e "const p = require('./pkg/package.json'); console.assert(p.piConfig.name === 'labrat'); console.assert(p.piConfig.configDir === '.labrat'); console.log('ok')"` prints ok

## Tasks

- [x] **T01: Merge GSD-2 source and verify vanilla build** `est:30m`
  - Why: Establish the baseline — GSD-2 code builds in our repo before any identity changes
  - Files: `package.json`, `package-lock.json`, all GSD-2 source files via merge
  - Do: Merge `upstream/main` into current branch with `--allow-unrelated-histories`. Run `npm install --ignore-scripts` (postinstall has interactive prompts). Run `npm run build`. Fix any build issues. This is a clean merge — labrat has no overlapping files except `.gitignore`.
  - Verify: `npm run build` exits 0
  - Done when: Full GSD-2 source is on the branch and builds without errors

- [x] **T02: Apply Labrat identity and rebuild** `est:45m`
  - Why: Transform the GSD-2 codebase identity to Labrat — package name, env vars, config paths, branding
  - Files: `package.json`, `pkg/package.json`, `src/loader.ts`, `src/app-paths.ts`, `src/logo.ts`, `src/cli.ts`, `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/subagent/index.ts`, `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/guided-flow.ts`
  - Do: (1) Update `package.json`: name→`labrat`, bin→`labrat`/`labrat-cli`, description. (2) Update `pkg/package.json`: piConfig name→`labrat`, configDir→`.labrat`. (3) Update `src/app-paths.ts`: `.gsd`→`.labrat`. (4) Rename all `GSD_*` env vars to `LABRAT_*` in `src/loader.ts`. (5) Update all `GSD_*` env var consumers in extensions via thorough grep. (6) Update `src/logo.ts` with LABRAT ASCII art. (7) Update `src/cli.ts` version/branding text. (8) Update banner text in `src/loader.ts`. (9) Rebuild. Keep `@gsd/*` workspace package names and `gsd` extension directory name unchanged — internal naming, no functional impact.
  - Verify: `npm run build` exits 0. Grep confirms no stale `GSD_*` env var references in `src/`. Package identity assertions pass.
  - Done when: Build passes, all identity references are Labrat, no stale GSD env vars in source

## Observability / Diagnostics

- **Build health:** `npm run build` exit code is the primary signal. Build output goes to `dist/` — check `ls dist/loader.js` for existence.
- **Dependency state:** `npm ls --depth=0` shows workspace packages and optional native bindings. `npm ls @gsd-build/engine-linux-x64-gnu` confirms platform-specific native module.
- **Identity verification:** The slice verification commands (grep for stale env vars, package.json assertions) are the diagnostic surface for identity changes.
- **Failure visibility:** Build errors emit to stderr with TypeScript diagnostics. Dependency failures show in `npm install` output. Merge conflicts show in `git status`.
- **Redaction:** No secrets or credentials involved in this slice. No redaction constraints.

## Files Likely Touched

- `package.json`
- `pkg/package.json`
- `src/loader.ts`
- `src/app-paths.ts`
- `src/logo.ts`
- `src/cli.ts`
- `src/resources/extensions/gsd/index.ts`
- `src/resources/extensions/subagent/index.ts`
- `src/resources/extensions/gsd/commands.ts`
- `src/resources/extensions/gsd/guided-flow.ts`
