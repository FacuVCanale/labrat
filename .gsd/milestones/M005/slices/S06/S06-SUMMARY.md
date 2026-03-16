---
id: S06
parent: M005
milestone: M005
provides:
  - End-to-end integration proof that scaffold→parser→builder→state→eval composes correctly (R049)
  - 53-assertion integration test covering scaffold roundtrip, prompt builders, state machine cycling, eval execution, JSONL sync, multi-hypothesis transition
  - Fix for startAuto 3-arg call with explicit verboseMode parameter
requires:
  - slice: S01
    provides: NightShift naming consistency in all user-facing surfaces
  - slice: S02
    provides: Karpathy auto-research analysis informing prompt design
  - slice: S03
    provides: /nightshift interview and scaffold generator with parser-compatible output
  - slice: S04
    provides: Four hypothesis-native prompt templates with exported builder functions
  - slice: S05
    provides: State machine dispatch, HYPOTHESIS-STATE.json, verifier analysis persistence
affects: []
key_files:
  - src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
  - src/resources/extensions/gsd/nightshift-interview.ts
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Path-embedded repo names excluded from naming compliance regex to avoid false positives on absolute paths in eval commands
patterns_established:
  - Integration test pattern: compose sub-components in tmpdir with real git repo without full runtime context
observability_surfaces:
  - Run integration test: npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts
  - Run full suite: all 5 hypothesis test files (313 assertions total)
  - HYPOTHESIS-STATE.json and EXPERIMENT-LOG.jsonl in test tmpdirs for post-mortem inspection
drill_down_paths:
  - .gsd/milestones/M005/slices/S06/tasks/T01-SUMMARY.md
  - .gsd/milestones/M005/slices/S06/tasks/T02-SUMMARY.md
duration: 20m
verification_result: passed
completed_at: 2026-03-16
---

# S06: End-to-End Integration

**53-assertion integration test proving full hypothesis flow composes correctly: scaffold→parser→builder→state→eval→JSONL→multi-hypothesis transition.**

## What Happened

This slice assembled and proved the composition of all five prior slices (S01–S05) into a working end-to-end hypothesis-driven research flow.

**T01 — Integration test + startAuto fix (15m):** Fixed `startAuto(ctx, pi, basePath)` → `startAuto(ctx, pi, basePath, false)` in nightshift-interview.ts to provide the required verboseMode parameter. Then built a 53-assertion integration test in four groups:

1. **Scaffold→Parser roundtrip:** Generates scaffold via `generateNightShiftScaffold`, parses through all three parsers (roadmap→slices, plan→tasks, campaign config). Verifies 2 slices, 3 tasks each, hypothesisMode=true, maxExperiments=3, correct metrics.
2. **Prompt builders:** Calls all four async builders (research, plan, execute, verify) with real scaffold data. Asserts non-empty output, metric references, and naming compliance (no \bGSD\b or \blabrat\b after stripping file paths).
3. **State machine cycling:** Creates initial state, advances through research→plan→execute→verify→plan+1→execute+1→verify+1→done. Verifies experiment number increments, null return on maxExperiments reached, completedPhases tracking.
4. **Eval + JSONL:** Inits real git repo, copies karpathy-smoke train.py, runs `runEval` against fixture, parses JSON metrics, verifies `countExperiments` increments correctly with `appendExperimentLog`.

**T02 — R049 validation + full suite (5m):** Ran all 313 assertions across 5 test files with 0 failures. Confirmed `tsc --noEmit` clean. Updated R049 in REQUIREMENTS.md from active→validated with concrete evidence. Updated traceability table and coverage counts (0 active, 38 validated).

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — **53 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — **43 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — **49 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — **69 passed, 0 failed**
- `npx tsx src/resources/extensions/gsd/tests/nightshift-interview.test.ts` — **99 passed, 0 failed**
- `npx tsc --noEmit` — clean, no errors
- R049 shows `validated` in REQUIREMENTS.md with 0 active requirements remaining

## Requirements Validated

- R049 — End-to-End Hypothesis Flow: 53-assertion integration test proving scaffold roundtrip through all three parsers, all four prompt builders produce non-empty output with real scaffold data, full state machine cycling (research→plan→execute→verify→plan+1→done), real eval execution against karpathy-smoke fixture, JSONL experiment count synchronized with state, multi-hypothesis transition (H1 complete → H2 active via deriveState). 313 total assertions across 5 test files, 0 failures.

## Requirements Advanced

- None (R049 was the only remaining active requirement; it moved directly to validated)

## New Requirements Surfaced

- None

## Requirements Invalidated or Re-scoped

- None

## Deviations

None. The integration test proved composition worked as designed — no wiring fixes were needed beyond the already-planned startAuto verboseMode fix.

## Known Limitations

- Runtime validation of research agent depth (does it actually follow multi-source research instructions?) not exercised — the integration test proves prompt content but not LLM adherence. This is UAT territory.
- Multi-hypothesis transition tested via state functions, not via full dispatch loop with real agent dispatch.

## Follow-ups

- None — this is the final slice of M005. The milestone is complete.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — new 53-assertion integration test (R049 proof)
- `src/resources/extensions/gsd/nightshift-interview.ts` — 1-line fix: startAuto call with explicit `false` verboseMode
- `.gsd/REQUIREMENTS.md` — R049 validated with evidence, traceability table updated, coverage counts updated (0 active, 38 validated)

## Forward Intelligence

### What the next slice should know
- M005 is complete. All 8 requirements (R042–R049) validated. 313 hypothesis-specific assertions across 5 test files.
- The hypothesis flow is fully assembled: `/nightshift` → interview → scaffold → state machine → prompt builders → eval → JSONL. No remaining wiring needed.

### What's fragile
- Naming compliance regex in the integration test strips absolute file paths before checking for \bGSD\b/\blabrat\b — if eval commands or scaffold paths change format, the stripping logic may need updating.
- Prompt builder tests depend on template file content — if templates change, both unit tests (hypothesis-prompt.test.ts) and integration tests will flag differences.

### Authoritative diagnostics
- `hypothesis-integration.test.ts` assertions are grouped by subsystem — if composition breaks, the group name identifies which boundary failed.
- HYPOTHESIS-STATE.json phase transitions print to stderr during tests, making state flow visible.

### What assumptions changed
- No assumptions changed — the integration test confirmed all S01–S05 components compose as designed.
