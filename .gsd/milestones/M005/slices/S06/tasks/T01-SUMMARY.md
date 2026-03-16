---
id: T01
parent: S06
milestone: M005
provides:
  - End-to-end integration test proving scaffold→parser→builder→state→eval composition (R049)
  - Fix for startAuto 3-arg call with explicit verboseMode parameter
key_files:
  - src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
  - src/resources/extensions/gsd/nightshift-interview.ts
key_decisions:
  - Path-embedded repo names excluded from naming compliance regex to avoid false positives on absolute paths in eval commands
patterns_established:
  - Integration test pattern: compose sub-components in tmpdir without full runtime context
observability_surfaces:
  - Run test directly: npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
  - Assertion names describe what failed; tmpdir contents inspectable if cleanup disabled
duration: 15m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Integration test proving scaffold→dispatch→eval→state composition

**Built 53-assertion integration test proving full hypothesis flow composes correctly, plus 1-line startAuto fix.**

## What Happened

1. Fixed `startAuto(ctx, pi, basePath)` → `startAuto(ctx, pi, basePath, false)` at line 365 of nightshift-interview.ts to provide explicit verboseMode parameter.

2. Created `hypothesis-integration.test.ts` with four test groups:
   - **Scaffold→Parser roundtrip:** Generates scaffold via `generateNightShiftScaffold`, parses roadmap (2 slices), parses each slice plan (3 tasks each), parses CAMPAIGN.json (hypothesisMode=true, maxExperiments=3, correct metrics).
   - **Prompt builders:** Calls all four async builders (research, plan, execute, verify) with real scaffold data. Asserts non-empty output, metric references, and naming compliance (no \bGSD\b or \blabrat\b after stripping file paths).
   - **State machine cycling:** Creates initial state, advances through research→plan→execute→verify, verifies experiment number increments on verify→plan+1, verifies null return on maxExperiments reached, confirms completedPhases includes all phases.
   - **Eval + JSONL:** Inits real git repo, copies karpathy-smoke train.py, runs `runEval` against the eval fixture, parses JSON metrics from stdout, verifies `countExperiments` increments correctly with `appendExperimentLog`.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — **53 passed, 0 failed**
- `npx tsc --noEmit` — clean (no errors)
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — **43 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — **49 passed, 0 failed**

Slice-level verification status:
- ✅ Integration test passes with all assertions
- ✅ Existing hypothesis tests still pass (43 + 49 confirmed, T02 runs the full suite)
- ✅ `tsc --noEmit` compiles clean
- ⏳ R049 validation in REQUIREMENTS.md (T02)

## Diagnostics

Run the test file directly — assertion names describe what failed. State transition messages appear on stderr during the state machine cycling group. HYPOTHESIS-STATE.json and EXPERIMENT-LOG.jsonl are created in test tmpdirs.

## Deviations

Naming compliance regex strips file paths (absolute paths like `/home/.../labrat/examples/...`) before checking for \bGSD\b/\blabrat\b. The eval command embeds the absolute path to karpathy-smoke which contains the repo directory name — this is a path, not a branding violation.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — new 53-assertion integration test (R049 proof)
- `src/resources/extensions/gsd/nightshift-interview.ts` — 1-line fix: startAuto call with explicit `false` verboseMode
