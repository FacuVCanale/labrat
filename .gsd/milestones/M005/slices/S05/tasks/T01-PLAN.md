---
estimated_steps: 10
estimated_files: 6
---

# T01: Wire hypothesis sub-phase dispatch and state machine

**Slice:** S05 — Learning Loop & State Flow
**Milestone:** M005

## Description

Introduce the four hypothesis sub-phase unit types (`research-hypothesis`, `plan-hypothesis`, `execute-hypothesis`, `verify-hypothesis`) with HYPOTHESIS-STATE.json tracking, dispatch routing in `dispatchNextUnit`, post-processing in `handleAgentEnd`, and all switch-site extensions. This is the core production code for hypothesis-driven experiment cycling.

The key design: when `dispatchNextUnit` encounters `phase === "experimenting"` and the campaign has `hypothesisMode: true`, it reads HYPOTHESIS-STATE.json to determine the current sub-phase (research/plan/execute/verify) and dispatches the corresponding unit type with the appropriate S04 builder. Campaigns without `hypothesisMode` fall through to the existing `run-experiment` path unchanged.

## Steps

1. **Add `hypothesisMode?: boolean` to CampaignConfig** in `types.ts`. Optional field, backward compatible.

2. **Create `hypothesis-state.ts` module** following the agenda.ts pattern:
   - `HypothesisState` interface: `{ version: 1, subPhase: 'research' | 'plan' | 'execute' | 'verify', experimentNumber: number, completedPhases: string[] }`
   - `readHypothesisState(sliceDir)` — returns null on missing/corrupt (same pattern as readAgendaState)
   - `writeHypothesisState(sliceDir, state)` — atomic write-to-temp-then-rename (D045)
   - `advanceHypothesisPhase(sliceDir, fromPhase)` — transitions: research→plan, plan→execute, execute→verify, verify→plan (with experimentNumber++) or done
   - `formatResultsForVerify(result: ExperimentResult)` — converts ExperimentResult to readable markdown string for the verify prompt's `currentResults` parameter
   - Import ExperimentResult from types.ts

3. **Modify `plan-experiment.md` prompt** to add a file-write instruction in the Output section: instruct agent to write the plan to `{{sliceDir}}/EXPERIMENT-{{experimentNumber}}-PLAN.md` in addition to the structured response. This is additive — keep existing content, add a paragraph after the output format telling the agent to persist the plan to disk.

4. **Replace the `experimenting` block in `dispatchNextUnit`** (auto.ts ~line 1426-1446):
   - Read `config.hypothesisMode`
   - If true: read HYPOTHESIS-STATE.json (create initial state if missing: subPhase='research', experimentNumber=1), then dispatch based on subPhase:
     - `research`: unitType='research-hypothesis', unitId=`${mid}/${sid}/research`, prompt from `buildResearchHypothesisPrompt`
     - `plan`: unitType='plan-hypothesis', unitId=`${mid}/${sid}/E${padded(expNum)}/plan`, prompt from `buildPlanExperimentPrompt`
     - `execute`: unitType='execute-hypothesis', unitId=`${mid}/${sid}/E${padded(expNum)}/execute`, read EXPERIMENT-NNN-PLAN.md from disk as experimentPlan, prompt from `buildExecuteExperimentPrompt`
     - `verify`: unitType='verify-hypothesis', unitId=`${mid}/${sid}/E${padded(expNum)}/verify`, read EXPERIMENT-NNN-RESULTS.md as currentResults, prompt from `buildVerifyExperimentPrompt`
   - If false (or absent): existing `run-experiment` path unchanged
   - Keep existing steering and agenda checks for both paths

5. **Add `handleAgentEnd` cases** for new unit types (auto.ts ~line 620):
   - `execute-hypothesis`: Run eval via `runExperimentPostProcess`, format results via `formatResultsForVerify`, write to `EXPERIMENT-NNN-RESULTS.md` in slice dir, advance hypothesis state to 'verify', do phase attribution (stampPhaseIndex), update lastProgressAt, run budget guard (copy from run-experiment). Notify with experiment result.
   - `plan-hypothesis`: Advance hypothesis state to 'execute'. Lightweight — plan file written by agent per prompt instruction.
   - `verify-hypothesis`: Advance hypothesis state to 'plan' (incrementing experimentNumber) or mark hypothesis complete if experiments exhausted. Analysis file written by agent per prompt instruction.
   - `research-hypothesis`: Advance hypothesis state to 'plan'. Lightweight — research file written by agent per prompt instruction.
   - MLOps logging for execute-hypothesis (same as run-experiment).

6. **Extend all switch sites** in auto.ts:
   - `unitVerb`: research-hypothesis→"researching", plan-hypothesis→"planning", execute-hypothesis→"experimenting", verify-hypothesis→"verifying"
   - `unitPhaseLabel`: RESEARCH, PLAN, EXPERIMENT, VERIFY
   - `peekNext`: research-hypothesis→"plan experiment 1", plan-hypothesis→"execute experiment", execute-hypothesis→"verify experiment", verify-hypothesis→"next experiment"
   - `resolveExpectedArtifactPath`: research-hypothesis→HYPOTHESIS-RESEARCH.md, plan-hypothesis→EXPERIMENT-NNN-PLAN.md, execute-hypothesis→EXPERIMENT-LOG.jsonl, verify-hypothesis→EXPERIMENT-NNN-ANALYSIS.md
   - `diagnoseExpectedArtifact`: descriptive strings for each type
   - `ensurePreconditions` line 3028: add all four types to the includes array
   - `recoverTimedOutUnit`: execute-hypothesis gets orphan revert logic (similar to run-experiment); others just re-dispatch

7. **Extend `SLICE_DISPATCH_TYPES`** in dispatch-guard.ts with all four new unit types.

8. **Update `nightshift-interview.ts`** scaffold: add `hypothesisMode: true` to the CAMPAIGN.json object.

9. **Lock enrichment**: in the lock-writing section, set `experimentNumber` for `execute-hypothesis` dispatches (same pattern as existing `dispatchedExpNum`).

10. **Import wiring**: add hypothesis-state.ts imports to auto.ts.

## Must-Haves

- [ ] HypothesisState type with version, subPhase, experimentNumber, completedPhases
- [ ] Atomic read/write for HYPOTHESIS-STATE.json (null on missing/corrupt, temp+rename on write)
- [ ] dispatchNextUnit routes hypothesis-mode campaigns through sub-phase dispatch
- [ ] dispatchNextUnit routes non-hypothesis campaigns through existing run-experiment path (backward compat)
- [ ] handleAgentEnd for execute-hypothesis runs eval and persists EXPERIMENT-NNN-RESULTS.md
- [ ] handleAgentEnd for verify-hypothesis advances to next experiment or marks hypothesis done
- [ ] Plan prompt instructs writing EXPERIMENT-NNN-PLAN.md to disk
- [ ] All 8 switch sites extended (unitVerb, unitPhaseLabel, peekNext, resolveExpectedArtifactPath, diagnoseExpectedArtifact, ensurePreconditions, recoverTimedOutUnit, SLICE_DISPATCH_TYPES)
- [ ] hypothesisMode on CampaignConfig and in NightShift scaffold
- [ ] TypeScript compiles clean

## Verification

- `npx tsc --noEmit` — compiles clean with all new types and imports
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — existing 69 assertions still pass (plan prompt modification is additive)
- Manual inspection: grep for all 4 new unit type strings in auto.ts to confirm switch coverage

## Observability Impact

- Signals added: `[hypothesis]` stderr prefix on state transitions (advanceHypothesisPhase, corrupt state warnings)
- How a future agent inspects this: `jq '.' .gsd/milestones/M001/slices/S01/HYPOTHESIS-STATE.json`
- Failure state exposed: corrupt HYPOTHESIS-STATE.json → stderr warning + fall back to initial state; missing EXPERIMENT-NNN-PLAN.md at execute dispatch → use placeholder; missing EXPERIMENT-NNN-RESULTS.md at verify dispatch → use placeholder

## Inputs

- `src/resources/extensions/gsd/auto.ts` — dispatchNextUnit, handleAgentEnd, switch sites, S04 builders
- `src/resources/extensions/gsd/agenda.ts` — pattern for atomic state file I/O
- `src/resources/extensions/gsd/eval-runner.ts` — runExperimentPostProcess, ExperimentResult
- `src/resources/extensions/gsd/types.ts` — CampaignConfig
- `src/resources/extensions/gsd/dispatch-guard.ts` — SLICE_DISPATCH_TYPES
- `.gsd/milestones/M005/slices/S04/S04-SUMMARY.md` — builder signatures and D088 constraint

## Expected Output

- `src/resources/extensions/gsd/hypothesis-state.ts` — new module (~120 lines)
- `src/resources/extensions/gsd/auto.ts` — modified: ~80 lines added (dispatch block, handleAgentEnd cases), ~40 lines of switch-site additions
- `src/resources/extensions/gsd/dispatch-guard.ts` — 4 new entries in SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/types.ts` — 1 new optional field
- `src/resources/extensions/gsd/nightshift-interview.ts` — 1 line added to scaffold
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — ~4 lines added (disk write instruction)
