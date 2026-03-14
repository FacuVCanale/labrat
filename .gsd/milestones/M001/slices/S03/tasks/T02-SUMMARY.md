---
id: T02
parent: S03
milestone: M001
provides:
  - handleAgentEnd wiring for run-experiment eval post-processing
key_files:
  - src/resources/extensions/gsd/auto.ts
key_decisions:
  - Eval hook runs between auto-commit and doctor/state-rebuild — this ordering means the eval sees the committed code, and doctor runs after any revert
  - UI notification level varies: "info" for keep, "warn" for discard, "error" for eval crash — makes triage easy in notification stream
patterns_established:
  - Non-fatal post-processing hooks in handleAgentEnd follow try/catch + ctx.ui.notify pattern
observability_surfaces:
  - UI notification per experiment: "Experiment exp-NNN: ✓ Kept / ✗ Discarded — reason (metric=value)"
  - Eval crash notification: "Experiment eval failed (non-fatal): <message>"
duration: 12m
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T02: Wire eval post-processing into handleAgentEnd

**Wired `runExperimentPostProcess` into handleAgentEnd so `run-experiment` units trigger eval → keep/discard after auto-commit.**

## What Happened

Added two imports to auto.ts: `countExperiments` from state.ts and `runExperimentPostProcess` from eval-runner.ts. Inserted a 20-line block in handleAgentEnd between the auto-commit try/catch and the doctor/state-rebuild block.

The hook: guards on `currentUnit.type === "run-experiment"`, derives sliceDir from the unit ID (`M001/S01` → full path), gets HEAD commit hash, calculates experiment number from existing log count +1, calls `runExperimentPostProcess()`. On success, emits a UI notification with experiment ID, keep/discard verb, reason, and metric values. On error, emits an error notification and continues — eval failure never crashes the dispatch loop.

## Verification

- `npm run build` — exits 0, no type errors
- `npx tsx eval-runner.test.ts` — 66/66 contract tests pass
- `npx tsx derive-state.test.ts` — 106/106 pass (no regression)
- `npx tsx dispatch-guard.test.ts` — 4/4 pass (no regression)
- `grep -A5 'runExperimentPostProcess' auto.ts` confirms hook at line 560, correctly placed between auto-commit (line 544) and doctor (line 581)

### Slice-level verification status (S03)

- [x] `npm test -- eval-runner.test.ts` — 66 assertions pass
- [x] `npm run build` — exits 0
- [x] Existing test suite passes (derive-state, dispatch-guard)

All slice verification checks pass. S03 is ready for completion.

## Diagnostics

- **Runtime:** After any `run-experiment` unit completes, check for `"Experiment exp-"` in UI notification output
- **Decision history:** `grep 'discard\|keep' .gsd/milestones/M001/slices/S01/EXPERIMENT-LOG.jsonl` (adjust slice path)
- **Eval failures:** Search for `"Experiment eval failed"` in notification/log output — indicates eval crashed but dispatch continued

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/auto.ts` — added imports for `countExperiments` and `runExperimentPostProcess`; added ~20-line experiment post-processing block in handleAgentEnd
- `.gsd/milestones/M001/slices/S03/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
