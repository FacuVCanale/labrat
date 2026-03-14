# S01: Repository Bootstrap & Build — Research

**Date:** 2026-03-13

## Summary

The labrat repo is a fresh git repo with only `.gsd/` planning artifacts — no GSD-2 source code exists on any local branch yet. The upstream remote (`gsd-build/gsd-2`) is already configured, pointing at v2.10.6. The histories are disjoint (no common ancestor between `main` and `upstream/main`), so the bootstrap is a one-time merge with `--allow-unrelated-histories` to bring the full GSD-2 source into the labrat repo, followed by identity changes.

GSD-2 is a TypeScript monorepo with 5 workspace packages (`pi-tui`, `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `native`) plus a root `src/` directory. The build chain is: build workspace packages in order → `tsc` on root `src/` → copy theme assets. The native Rust bindings (`@gsd/native`) load via N-API, with prebuilt platform packages (`@gsd-build/engine-linux-x64-gnu` etc.) available on npm as optional dependencies — no Rust toolchain needed for dev. Node.js 22.22.1 and npm 10.9.4 are available on this system.

Identity changes are well-contained. The SDK (`pi-coding-agent`) reads `piConfig.name` and `piConfig.configDir` from the `pkg/package.json` (set via `PI_PACKAGE_DIR` env var) to derive app name and config directory. Key touchpoints: `package.json` (name, bin, description), `pkg/package.json` (piConfig), `src/loader.ts` (process.title, env vars, banner), `src/app-paths.ts` (hardcoded `~/.gsd`), `src/logo.ts` (ASCII art), `src/cli.ts` (version display). Env var names like `GSD_VERSION`, `GSD_BIN_PATH`, `GSD_WORKFLOW_PATH`, `GSD_BUNDLED_EXTENSION_PATHS`, `GSD_CODING_AGENT_DIR` are consumed by extensions at runtime and need renaming.

## Recommendation

**Approach: Merge upstream/main into main with `--allow-unrelated-histories`, then apply identity changes as a follow-up commit.**

The merge brings all GSD-2 files cleanly since labrat's `main` has no overlapping paths (only `.gsd/` and `.gitignore`). After merge, apply surgical identity renames:

1. `package.json` — name→`labrat`, bin→`labrat`/`labrat-cli`, description, repository/homepage/bugs URLs
2. `pkg/package.json` — piConfig name→`labrat`, configDir→`.labrat`
3. `src/loader.ts` — process.title, env var names (GSD_→LABRAT_), banner text
4. `src/app-paths.ts` — `.gsd`→`.labrat` paths
5. `src/logo.ts` — new ASCII art for LABRAT
6. `src/cli.ts` — version display text
7. Env var consumers in extensions — `GSD_VERSION`→`LABRAT_VERSION`, etc.
8. `README.md` — project description

Keep the `gsd` extension directory name as-is for now — it's internal structure, and renaming it cascades into many files for no functional benefit. The piConfig approach means the app name and config dir are already parameterized at the SDK level.

Verify with `npm run build` and `npm test` passing.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Multi-provider LLM support | `@gsd/pi-ai` (20+ providers) | Inherited, zero changes needed (R015) |
| Build system | npm workspaces + tsc | Already works, just need to run it |
| Native Rust bindings | `@gsd-build/engine-*` npm packages | Prebuilt binaries, no Rust toolchain needed |
| Extension system | `pi-coding-agent` extension API | Inherited, drives all GSD tooling |
| Cost/token tracking | `src/resources/extensions/gsd/metrics.ts` | Inherited, functional as-is |
| Crash recovery | `src/resources/extensions/gsd/crash-recovery.ts` | Inherited, functional as-is |
| Git operations | `src/resources/extensions/gsd/git-service.ts` | Inherited, functional as-is |

## Existing Code and Patterns

- `src/loader.ts` — Entry point. Sets `PI_PACKAGE_DIR` to `pkg/`, sets env vars, imports `cli.ts`. This is where identity is established before any SDK code runs.
- `src/app-paths.ts` — Hardcodes `~/.gsd` as appRoot. Must change to `~/.labrat`.
- `src/cli.ts` — Main CLI logic. Imports from `@gsd/pi-coding-agent`. References `GSD_VERSION` env var.
- `src/logo.ts` — ASCII art logo. Exported as `GSD_LOGO` constant.
- `pkg/package.json` — Contains `piConfig` with `name: "gsd"` and `configDir: ".gsd"`. The SDK's `config.ts` reads this via `getPackageDir()` to derive `APP_NAME` and `CONFIG_DIR_NAME`.
- `packages/pi-coding-agent/src/config.ts` — Reads piConfig, derives all paths from `CONFIG_DIR_NAME`. No changes needed — it's parameterized.
- `src/resources/extensions/gsd/index.ts` — Main GSD extension. Reads `GSD_VERSION` from env.
- `src/resources/extensions/subagent/index.ts` — Reads `GSD_BUNDLED_EXTENSION_PATHS` and `GSD_BIN_PATH` from env to spawn child processes.
- `src/resources/extensions/gsd/commands.ts` and `guided-flow.ts` — Read `GSD_WORKFLOW_PATH` from env.
- `tsconfig.json` — Excludes `src/resources` and `src/tests` from compilation. Extensions are type-checked separately via `tsconfig.extensions.json`.
- `package.json` scripts — `build` = package builds + tsc + copy-themes. `test` = node --test with custom resolver for `.ts` extensions.

## Constraints

- **No Rust toolchain on this system** — Must rely on `@gsd-build/engine-*` npm optional dependencies for native module loading. The `loadNative()` function in `packages/native/src/native.ts` tries npm packages first, then local builds. If the npm package installs, native works.
- **Node.js 22.22.1** — Well within the `>=20.6.0` engine requirement.
- **npm workspaces** — Build order matters: `native` → `pi-tui` → `pi-ai` → `pi-agent-core` → `pi-coding-agent` → root `tsc`. The `build:pi` script handles this.
- **`src/resources/` not compiled by tsc** — Extensions are loaded at runtime by `jiti` (dynamic TypeScript compilation). They're type-checked separately but never emitted to `dist/`.
- **piConfig identity chain** — `PI_PACKAGE_DIR` → `pkg/package.json` → `piConfig.name` + `piConfig.configDir` → `APP_NAME` + `CONFIG_DIR_NAME` → all config paths. Changing `pkg/package.json` is the single control point.
- **Workspace package names stay `@gsd/*`** — These are internal workspace references using `*` versions. Renaming them cascades into every package's dependencies and all import statements across the codebase. Not worth it for internal packages that aren't published under the labrat name.
- **Disjoint git histories** — `main` and `upstream/main` share no common ancestor. Merge requires `--allow-unrelated-histories`. Future cherry-picks from upstream will need to be manual.

## Common Pitfalls

- **Renaming the `gsd` extension directory** — Tempting but cascading. The directory name `gsd` appears in import paths, the loader's `GSD_BUNDLED_EXTENSION_PATHS`, test paths, and the extension's `package.json`. Leave it as internal naming; the user-facing name comes from piConfig.
- **Forgetting env var renames in extensions** — `GSD_VERSION`, `GSD_BIN_PATH`, `GSD_WORKFLOW_PATH`, `GSD_BUNDLED_EXTENSION_PATHS`, and `GSD_CODING_AGENT_DIR` are read in multiple files. Grep thoroughly. The `ENV_AGENT_DIR` in config.ts auto-derives from `APP_NAME.toUpperCase()`, so changing piConfig.name to `labrat` will make it look for `LABRAT_CODING_AGENT_DIR`.
- **`npm install` failing on optional native deps** — If `@gsd-build/engine-linux-x64-gnu` fails to install, the build will succeed but runtime will crash. Check `npm ls @gsd-build/engine-linux-x64-gnu` after install.
- **package-lock.json name mismatch** — After changing `package.json` name, the lockfile becomes stale. Need to regenerate via `npm install` after rename.
- **postinstall script** — `scripts/postinstall.js` runs clack prompts and tries to set up the environment. During dev/CI, this could block. May need `--ignore-scripts` or guard it.

## Open Risks

- **`npm test` may have GSD-specific test assumptions** — Tests in `src/resources/extensions/gsd/tests/` reference GSD paths and env vars. Some may need adaptation, but most should pass since they mock their own state. Worth running first and seeing what breaks.
- **Cherry-pick workflow from upstream** — With disjoint histories, `git cherry-pick` from upstream/main may conflict on files we've modified (package.json, loader.ts, etc.). Manageable but needs manual resolution each time. Per D009, this is expected.
- **Extension runtime path resolution** — `src/resource-loader.ts` syncs bundled extensions to `~/.labrat/agent/extensions/` on every launch. If the GSD extension at that path conflicts with an existing GSD installation's `~/.gsd/agent/extensions/`, there's no collision since they use different config dirs. But testing on a system with GSD-2 installed needs care.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript/Node.js monorepo | searched `npx skills find` | none relevant found |

## Sources

- GSD-2 source code at `upstream/main` (v2.10.6) — all findings from direct code inspection
- `packages/pi-coding-agent/src/config.ts` — piConfig identity chain documentation
- `packages/native/src/native.ts` — native addon loading strategy with npm package fallback
- `@gsd-build/engine-linux-x64-gnu` v2.10.6 verified published on npm
