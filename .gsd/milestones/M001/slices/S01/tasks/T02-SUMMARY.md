---
id: T02
parent: S01
milestone: M001
provides:
  - Labrat-branded codebase — package name, bin entries, piConfig, config dir, env vars, logo, CLI text
  - Clean build output in dist/ with all identity changes applied
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
  - scripts/postinstall.js
  - src/tests/app-smoke.test.ts
key_decisions:
  - Kept @gsd/* workspace package names and gsd extension directory name unchanged (internal, rename cascades into every import for no user-facing benefit)
  - Updated NPM_PACKAGE constants in update-cmd.ts and update-check.ts to 'labrat' for update flow consistency
  - Updated smoke tests to assert the new identity (LABRAT_* env vars, .labrat paths, labrat binary name)
patterns_established:
  - All user-facing env vars use LABRAT_ prefix; internal @gsd/* workspace names are unchanged
  - Config directory is ~/.labrat/ (appRoot, agentDir, sessionsDir, authFilePath all derive from this)
observability_surfaces:
  - "grep -r 'GSD_VERSION|GSD_BIN_PATH|GSD_WORKFLOW_PATH|GSD_BUNDLED_EXTENSION_PATHS|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'" returns empty — stale reference detector
  - "node -e \"const p = require('./package.json'); console.assert(p.name === 'labrat')\"" — identity check
  - "--version flag prints LABRAT_VERSION value"
  - "--help shows labrat usage and branding"
duration: 20m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Apply Labrat identity and rebuild

**Transformed GSD-2 codebase identity to Labrat across package metadata, env vars, config paths, CLI branding, ASCII logo, and tests.**

## What Happened

Updated all identity touchpoints in the codebase:

1. **package.json**: name→`labrat`, bin→`labrat`/`labrat-cli`, description→research-oriented, repo/homepage/bugs URLs updated.
2. **pkg/package.json**: piConfig name→`labrat`, configDir→`.labrat`, package name→`@labrat/pkg`.
3. **src/app-paths.ts**: `.gsd`→`.labrat` in appRoot path.
4. **src/loader.ts**: All 5 env vars renamed (`GSD_CODING_AGENT_DIR`→`LABRAT_CODING_AGENT_DIR`, etc.), process.title→`labrat`, banner text→`Labrat`, internal variable names updated (`gsdRoot`→`labratRoot`).
5. **Extension consumers**: Updated `GSD_WORKFLOW_PATH`→`LABRAT_WORKFLOW_PATH` in commands.ts and guided-flow.ts, `GSD_VERSION`→`LABRAT_VERSION` in gsd/index.ts, `GSD_BUNDLED_EXTENSION_PATHS`/`GSD_BIN_PATH`→`LABRAT_*` in subagent/index.ts.
6. **src/logo.ts**: Replaced GSD block-letter ASCII art with LABRAT block-letter ASCII art. Also updated the matching logo in gsd/index.ts header rendering.
7. **src/cli.ts**: Version display, help text, error prefixes all updated to labrat branding.
8. **Additional files**: update-cmd.ts, update-check.ts (NPM package name + version env var), onboarding.ts (welcome/launch text), scripts/postinstall.js (run instructions).
9. **Tests**: Updated app-smoke.test.ts assertions to verify `.labrat` paths, `LABRAT_*` env vars, `labrat` binary name, and piConfig identity.

## Verification

All checks passed:

- `npm run build` exits 0 — clean build
- `grep -r 'GSD_VERSION|GSD_BIN_PATH|GSD_WORKFLOW_PATH|GSD_BUNDLED_EXTENSION_PATHS|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'` returns empty — no stale env var references
- `node -e "const p = require('./package.json'); console.assert(p.name === 'labrat'); console.assert(p.bin.labrat); console.log('identity ok')"` prints "identity ok"
- `node -e "const p = require('./pkg/package.json'); console.assert(p.piConfig.name === 'labrat'); console.assert(p.piConfig.configDir === '.labrat'); console.log('piConfig ok')"` prints "piConfig ok"
- `grep '.labrat' src/app-paths.ts` shows the updated path

All slice-level verification checks pass. This is the final task in S01.

## Diagnostics

- **Stale reference check:** `grep -r 'GSD_VERSION\|GSD_BIN_PATH\|GSD_WORKFLOW_PATH\|GSD_BUNDLED_EXTENSION_PATHS\|GSD_CODING_AGENT_DIR' src/ --include='*.ts' | grep -v 'LABRAT_'` — should return empty
- **Identity assertions:** The node one-liners in Verification section above
- **Build health:** `npm run build` exit code; `ls dist/loader.js` for existence

## Deviations

- Updated `src/update-cmd.ts`, `src/update-check.ts`, `src/onboarding.ts`, and `scripts/postinstall.js` — not in original plan's file list but contained GSD branding/references that needed updating for complete identity transformation.
- Updated `src/tests/app-smoke.test.ts` — not in original plan but tests were asserting old identity values and would have failed.
- Updated `src/resource-loader.ts` comments referencing `~/.gsd/` paths and GSD package name.

## Known Issues

None.

## Files Created/Modified

- `package.json` — name, bin, description, repo URLs, piConfig
- `pkg/package.json` — piConfig name/configDir, package name
- `src/app-paths.ts` — `.gsd`→`.labrat` in appRoot
- `src/loader.ts` — all 5 env vars renamed, process.title, banner text, variable names
- `src/logo.ts` — GSD ASCII art replaced with LABRAT ASCII art
- `src/cli.ts` — version display, help text, error prefixes, usage examples
- `src/resources/extensions/gsd/index.ts` — logo lines, title line, version env var
- `src/resources/extensions/gsd/commands.ts` — workflow path env var
- `src/resources/extensions/gsd/guided-flow.ts` — workflow path env var
- `src/resources/extensions/subagent/index.ts` — bundled paths and bin path env vars
- `src/update-cmd.ts` — NPM package name, version env var
- `src/update-check.ts` — NPM package name, version env var, update instructions
- `src/onboarding.ts` — welcome/launch branding text
- `src/resource-loader.ts` — comments referencing config paths
- `scripts/postinstall.js` — post-install run instructions
- `src/tests/app-smoke.test.ts` — all identity assertions updated
- `.gsd/milestones/M001/slices/S01/tasks/T02-PLAN.md` — added Observability Impact section
