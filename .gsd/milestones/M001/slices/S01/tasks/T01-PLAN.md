---
estimated_steps: 4
estimated_files: 3
---

# T01: Merge GSD-2 source and verify vanilla build

**Slice:** S01 — Repository Bootstrap & Build
**Milestone:** M001

## Description

Merge the full GSD-2 v2.10.6 codebase from `upstream/main` into the labrat repo. The histories are disjoint (no common ancestor), so the merge requires `--allow-unrelated-histories`. Since labrat's branch only has `.gsd/` and `.gitignore`, there are no content conflicts — it's a clean merge.

After merge, install dependencies with `--ignore-scripts` (the postinstall script runs interactive clack prompts that would block CI/automation). Then run `npm run build` to prove the inherited codebase compiles in our repo before any identity changes are made.

## Steps

1. Run `git merge upstream/main --allow-unrelated-histories -m "merge: bring GSD-2 v2.10.6 source into labrat"`. Resolve any trivial conflicts (likely `.gitignore` only).
2. Run `npm install --ignore-scripts` to install all dependencies including workspace packages and optional native bindings.
3. Verify `@gsd-build/engine-linux-x64-gnu` installed successfully: `npm ls @gsd-build/engine-linux-x64-gnu`.
4. Run `npm run build` and fix any issues until it exits 0.

## Must-Haves

- [ ] GSD-2 v2.10.6 source fully merged into the working branch
- [ ] `npm install` completes with all workspace packages linked
- [ ] Native bindings package installed (optional dep)
- [ ] `npm run build` exits 0

## Verification

- `npm run build` exits 0
- `ls dist/loader.js` confirms build output exists
- `git log --oneline -1 upstream/main` hash appears in merge history

## Observability Impact

- **Signals added:** None — this task merges existing code without modification.
- **Inspection surface:** After this task, `npm run build` exit code and `ls dist/loader.js` confirm the codebase compiles. `git log --oneline` shows the merge commit with the upstream hash.
- **Failure visibility:** Build failures emit TypeScript diagnostics to stderr. Dependency issues surface via `npm ls` warnings. Merge conflicts appear in `git status`.

## Inputs

- `upstream/main` remote branch at v2.10.6 (already fetched)
- Current branch `gsd/M001/S01` with only `.gsd/` artifacts

## Expected Output

- Full GSD-2 source tree on the working branch (src/, packages/, pkg/, scripts/, etc.)
- `dist/` directory with compiled output
- `node_modules/` with all dependencies installed
- Clean merge commit in git history
