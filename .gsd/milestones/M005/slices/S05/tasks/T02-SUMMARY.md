---
id: T02
parent: S05
milestone: M005
provides:
  - Contract tests proving hypothesis state transitions, dispatch wiring, artifact paths, backward compatibility, and results formatting
key_files:
  - src/resources/extensions/gsd/tests/hypothesis-state.test.ts
  - src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts
key_decisions:
  - Used assertInc() pattern alongside test() wrapper to count inline assertions separately from test-level pass, enabling fine-grained assertion counting
  - parseCampaignConfig backward-compat tested via actual function call with temp CAMPAIGN.json rather than grep, proving runtime behavior not just source text
  - resolveExpectedArtifactPath tested with real temp .gsd directory tree rather than mocking paths module
patterns_established:
  - Hypothesis test files follow same harness as hypothesis-prompt.test.ts: passed/failed counters, test() wrapper, process.exit(1) on failure
  - Temp directory cleanup pattern: mkdtempSync + rmSync in each test for isolation
observability_surfaces:
  - `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — prints N passed, M failed; stderr shows [hypothesis] phase transitions and corruption warnings
  - `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — prints N passed, M failed; validates all switch-sites and artifact paths
duration: 15m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T02: Contract tests for hypothesis state flow and dispatch wiring

**92 total assertions across two test files proving hypothesis state machine, dispatch wiring, artifact paths, backward compatibility, and result formatting.**

## What Happened

Filled the T01 skeleton test files with comprehensive contract assertions:

**hypothesis-state.test.ts (43 assertions):**
- Read: missing file → null, corrupt JSON → null + stderr, invalid shape → null, empty file → null, invalid subPhase → null
- Write: round-trip, atomic (.tmp removed), JSON ends with newline
- Initial state: version=1, subPhase=research, experimentNumber=1, completedPhases=[]
- Phase transitions: research→plan, plan→execute, execute→verify, verify→plan(+1), verify→done(max), verify without max cycles indefinitely
- Full cycle: research→plan→execute→verify→plan(2) with completedPhases accumulation
- Bootstrap: advance from missing state creates initial then advances
- Formatting: markdown output with id, decision, reason, metrics, cost, duration, diff, simplicity score, empty metrics

**hypothesis-dispatch.test.ts (49 assertions):**
- Artifact paths via actual resolveExpectedArtifactPath calls: research→HYPOTHESIS-RESEARCH.md, plan→EXPERIMENT-N-PLAN.md, execute→EXPERIMENT-LOG.jsonl, verify→EXPERIMENT-N-ANALYSIS.md, unknown→null, run-experiment backward compat
- dispatch-guard.ts contains all 4 hypothesis types
- Switch-site coverage: unitVerb, unitPhaseLabel, peekNext, diagnoseExpectedArtifact, ensurePreconditions, recoverTimedOutUnit — all wired for 4 types
- CampaignConfig: hypothesisMode=true parses, missing hypothesisMode→undefined, missing file→null, invalid JSON→null, missing fields→null
- NightShift scaffold: hypothesisMode=true, writes CAMPAIGN.json
- plan-experiment.md: EXPERIMENT-{{experimentNumber}}-PLAN.md write instruction
- handleAgentEnd: all 4 types handled
- Dispatch routing: all 4 unitType assignments present

## Verification

- `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — **43 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — **49 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — **69 passed, 0 failed** ✓
- `npx tsc --noEmit` — **clean** ✓
- Total: 92 assertions across state+dispatch (well above ≥35 minimum)

## Diagnostics

- Run `npx tsx src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — observe stderr `[hypothesis] phase → plan|execute|verify|done` messages confirming transition logging works
- Run `npx tsx src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — validates all switch-sites and artifact path mappings via both grep and function calls
- Corrupt state warnings on stderr: `[hypothesis] Corrupt HYPOTHESIS-STATE.json in <dir>`

## Deviations

- Added `comparison: {}` to ExperimentResult test fixtures to match KeepDiscardDecision type (required field discovered at compile time, not mentioned in plan)
- Added several tests beyond plan minimum: empty file, invalid subPhase, verify without maxExperiments, completedPhases accumulation, bootstrap from missing state, parseCampaignConfig edge cases, dispatch routing assignments
- plan-hypothesis default E001 path tested (implicit from missing unitId segment)

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — Filled skeleton with 43 assertions: state I/O, phase transitions, formatting
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — Filled skeleton with 49 assertions: artifact paths, switch-sites, backward compat, dispatch routing
- `.gsd/milestones/M005/slices/S05/tasks/T02-PLAN.md` — Added Observability Impact section (pre-flight fix)
