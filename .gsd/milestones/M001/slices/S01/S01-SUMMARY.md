---
id: S01
parent: M001
milestone: M001
provides:
  - GSD-2 v2.10.6 full source tree merged and building as `labrat`
  - Package identity updated (name, bin, description, piConfig)
  - Config directory at ~/.labrat (appRoot, agentDir, sessionsDir, authFilePath)
  - All user-facing env vars renamed from GSD_* to LABRAT_*
  - Upstream remote preserved for future cherry-picks
  - All inherited infrastructure functional (build, LLM providers, extension system, cost tracking)
requires:
  - slice: none
    provides: first slice — no dependencies
affects:
  - S02
  - S03
  - S04
key_files:
  - package.json
  - pkg/package.json
  - src/app-paths.ts
  - src/loader.ts
  - src/logo.ts
  - src/cli.ts
  - src/resources/extensions/gsd/index.ts
  - src/resources/extensions/subagent/index.ts
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/update-cmd.ts
  - src/update-check.ts
  - src/onboarding.ts
  - src/tests/app-smoke.test.ts
key_decisions:
  - "Keep @gsd/* workspace package names and gsd extension directory unchanged — renaming cascades into every import for zero user-facing benefit (D011)"
  - "Resolved .gitignore merge conflict by keeping labrat's selective .gsd/ patterns combined with upstream's workspace and build artifact patterns"
patterns_established:
  - "All user-facing env vars use LABRAT_ prefix; internal @gsd/* workspace names unchanged"
  - "Config directory is ~/.labrat/ — all path derivation flows from appRoot in app-paths.ts"
  - "Use `npm install --ignore-scripts` to avoid interactive postinstall prompts during automation"
observability_surfaces:
  - "`npm run build` exit code — primary build health signal"
  - "`grep -r 'GSD_VERSION|GSD_BIN_PATH|...' src/ --include='*.ts' | grep -v 'LABRAT_'` — stale reference detector"
  - "package.json and pkg/package.json identity assertions — identity verification"
  - "`ls dist/loader.js` — build output existence check"
  - "`npm ls @gsd-build/engine-linux-x64-gnu` — native binding verification"
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md
duration: 30m
verification_result: passed
completed_at: 2026-03-13
---

# S01: Repository Bootstrap & Build

**GSD-2 v2.10.6 merged into labrat repo with full identity transformation — package name, env vars, config paths, CLI branding — building clean.**

## What Happened

Merged GSD-2 v2.10.6 (ac6f27e) into the labrat repo using `--allow-unrelated-histories`. Only conflict was `.gitignore` (add/add) — resolved by combining both sets of patterns. Installed dependencies with `--ignore-scripts` to skip interactive postinstall. Verified vanilla build passed before any identity changes.

Then transformed all identity touchpoints: package.json name/bin/description, piConfig name/configDir, app-paths.ts config directory (`.gsd`→`.labrat`), all five `GSD_*` env vars renamed to `LABRAT_*` in loader.ts and extension consumers, ASCII logo replaced, CLI branding updated, update-check/onboarding text updated, and smoke tests updated to assert new identity. Internal `@gsd/*` workspace package names left unchanged — renaming would cascade across every import for zero user-facing benefit.

## Verification

All slice-level checks passed:

- `npm run build` exits 0 — clean build across all workspace packages
- `grep` for stale `GSD_*` env var references returns empty — no stragglers
- `package.json` name is `labrat` with `labrat` bin entry
- `pkg/package.json` piConfig has `name: "labrat"`, `configDir: ".labrat"`
- `dist/loader.js` exists — build output confirmed
- `npm ls @gsd-build/engine-linux-x64-gnu` shows native binding present
- `src/app-paths.ts` references `.labrat`

## Requirements Advanced

- R001 — GSD-2 codebase merged, upstream remote set, builds and runs as labrat
- R015 — Full LLM provider support inherited from GSD-2, all 20+ providers available through unchanged infrastructure

## Requirements Validated

- R001 — Build passes, upstream remote configured, all inherited infrastructure functional. Full proof delivered.
- R015 — Zero changes needed to LLM provider infrastructure. All providers available as-is from GSD-2.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- Updated `src/update-cmd.ts`, `src/update-check.ts`, `src/onboarding.ts`, `scripts/postinstall.js`, and `src/resource-loader.ts` — not in original plan file list but contained GSD branding that needed updating for complete identity transformation.
- Updated `src/tests/app-smoke.test.ts` — tests were asserting old identity values and needed updating.

## Known Limitations

- Internal workspace packages still named `@gsd/*` and extension directory is still `gsd/`. This is intentional (D011) but could cause confusion if someone reads the source expecting everything to say "labrat".
- The labrat binary isn't published to npm yet — `labrat` command only works via local `node dist/loader.js` or npm link.

## Follow-ups

None. Clean handoff to S02.

## Files Created/Modified

- `package.json` — name, bin, description, repo URLs
- `pkg/package.json` — piConfig name/configDir, package name
- `src/app-paths.ts` — `.gsd`→`.labrat` in appRoot
- `src/loader.ts` — all 5 env vars renamed GSD_*→LABRAT_*, process.title, banner text
- `src/logo.ts` — LABRAT ASCII art
- `src/cli.ts` — version display, help text, error prefixes
- `src/resources/extensions/gsd/index.ts` — logo, title, version env var
- `src/resources/extensions/gsd/commands.ts` — workflow path env var
- `src/resources/extensions/gsd/guided-flow.ts` — workflow path env var
- `src/resources/extensions/subagent/index.ts` — bundled paths and bin path env vars
- `src/update-cmd.ts` — NPM package name, version env var
- `src/update-check.ts` — NPM package name, version env var
- `src/onboarding.ts` — welcome/launch branding
- `src/resource-loader.ts` — comments referencing config paths
- `scripts/postinstall.js` — post-install run instructions
- `src/tests/app-smoke.test.ts` — identity assertions updated
- `.gitignore` — merge conflict resolution

## Forward Intelligence

### What the next slice should know
- The codebase is a full GSD-2 fork. All files, all infrastructure, all complexity. The state machine lives in `src/` and the core loop is in `packages/pi-coding-agent/`. Research changes will primarily touch `packages/pi-coding-agent/` for the state machine and dispatch logic.
- `auto.ts` in `packages/pi-coding-agent/src/` is ~3000 lines and contains the main orchestration loop. This is where research flow semantics (S02) will need surgical changes.
- Env vars are `LABRAT_*` but internal code still uses GSD naming conventions in variables, functions, and comments. Don't rename those — it's the internal API surface.

### What's fragile
- The build depends on native bindings (`@gsd-build/engine-linux-x64-gnu`). If the platform changes or bindings aren't available, build will fail at the native package step.
- `npm install` must use `--ignore-scripts` in automation — the postinstall script has interactive prompts that hang in non-interactive contexts.

### Authoritative diagnostics
- `npm run build` exit code — the single most trustworthy signal for codebase health
- `grep` for stale `GSD_*` env vars — catches incomplete identity transformations
- `npm ls --depth=0` — shows dependency health and workspace package linkage

### What assumptions changed
- Original plan assumed only the listed files needed identity changes — in practice, update-check, onboarding, postinstall, resource-loader, and smoke tests also needed updates. The grep-based stale reference detector caught everything.
