# S05: Learning Loop & State Flow — Research

**Date:** 2026-03-16

## Summary

S05 must wire the four prompt builders from S04 into the dispatch pipeline, replacing the current single `run-experiment` unit with a per-hypothesis research phase and per-experiment plan→execute→verify cycling. The core challenge is that the existing state machine dispatches one unit at a time with no sub-state within the `experimenting` phase — it only knows "more experiments remain" and always dispatches `run-experiment`. The solution is to introduce new unit types for each hypothesis sub-phase (research-hypothesis, plan-hypothesis, execute-hypothesis, verify-hypothesis) with a `HYPOTHESIS-STATE.json` file tracking which sub-phase each slice is in. This approach keeps `deriveState()` untouched (still returns `experimenting`), concentrates all new logic in `dispatchNextUnit`, and leverages the existing `verifyExpectedArtifact` / `handleAgentEnd` patterns for each new unit type.

The verify agent writes EXPERIMENT-NNN-ANALYSIS.md per the S04 prompt template. The plan builder already reads these via `readLatestExperimentAnalysis()`. The missing piece is the eval→analysis→next-plan wiring: after `execute-hypothesis` runs and `handleAgentEnd` performs eval post-processing, the next dispatch must detect that verification is needed, build the verify prompt with eval results, and dispatch it. After verification, the analysis file on disk feeds forward automatically into the next experiment's plan prompt.

Primary recommendation: introduce four new unit types + HYPOTHESIS-STATE.json sub-state tracking, with eval post-processing moving from `handleAgentEnd` to the `verify-hypothesis` unit's result processing.

## Recommendation

**Introduce four new unit types within the `experimenting` phase, orchestrated by a per-slice `HYPOTHESIS-STATE.json` file:**

1. `research-hypothesis` — Dispatched once per hypothesis (slice). Writes HYPOTHESIS-RESEARCH.md. Artifact: HYPOTHESIS-RESEARCH.md.
2. `plan-hypothesis` — Dispatched before each experiment. Writes plan to disk (EXPERIMENT-NNN-PLAN.md). Artifact: EXPERIMENT-NNN-PLAN.md.
3. `execute-hypothesis` — Dispatched after plan. Modifies target files. No eval (eval happens post-processing). Artifact: EXPERIMENT-LOG.jsonl entry.
4. `verify-hypothesis` — Dispatched after execute+eval. Receives eval results. Writes EXPERIMENT-NNN-ANALYSIS.md. Artifact: EXPERIMENT-NNN-ANALYSIS.md.

**Why this over alternatives:**
- Keeping a single `run-experiment` with prompt-level phase switching would break `verifyExpectedArtifact` (expects EXPERIMENT-LOG.jsonl for all experiments, but research/plan/verify don't produce that).
- New unit types integrate naturally with the existing artifact verification, stuck detection, crash recovery, and idempotency patterns.
- `deriveState()` stays unchanged — still returns `phase: 'experimenting'`. All sub-phase logic lives in `dispatchNextUnit`.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Sub-phase tracking | AGENDA-STATE.json pattern (D044/D045) | Atomic JSON writes, crash-recoverable, proven pattern for phase state within a slice |
| Eval post-processing | `runExperimentPostProcess()` in eval-runner.ts | Already handles eval, scoring, keep/discard, JSONL append — just call it at the right point |
| Analysis persistence | `readLatestExperimentAnalysis()` from S04 | Already scans backwards for EXPERIMENT-NNN-ANALYSIS.md — just ensure verify writes them |
| Prompt building | S04 exported builders | All four builders ready — `buildResearchHypothesisPrompt`, `buildPlanExperimentPrompt`, `buildExecuteExperimentPrompt`, `buildVerifyExperimentPrompt` |
| Crash recovery | `recoverTimedOutUnit()` + `readCrashLock()` | Extend existing patterns for new unit types |
| Atomic file writes | write-to-temp-then-rename (D041/D045) | Same pattern for HYPOTHESIS-STATE.json |

## Existing Code and Patterns

- `src/resources/extensions/gsd/auto.ts:1426-1446` — Current `experimenting` phase dispatch block. Dispatches `run-experiment` with `buildExperimentPrompt`. **Replace** this with sub-phase-aware dispatch that reads HYPOTHESIS-STATE.json and calls the appropriate builder.
- `src/resources/extensions/gsd/auto.ts:620-690` — `handleAgentEnd` block for `run-experiment`. Runs eval via `runExperimentPostProcess`, does budget guard, MLOps logging. **Split**: eval stays in `execute-hypothesis` end handler, analysis writing is the `verify-hypothesis` agent's job.
- `src/resources/extensions/gsd/auto.ts:834-878` — `unitVerb`, `unitPhaseLabel`, `peekNext` switch statements. **Extend** with entries for the four new unit types.
- `src/resources/extensions/gsd/auto.ts:3438-3497` — `resolveExpectedArtifactPath`. **Extend** with cases for `research-hypothesis` (HYPOTHESIS-RESEARCH.md), `plan-hypothesis` (EXPERIMENT-NNN-PLAN.md), `execute-hypothesis` (EXPERIMENT-LOG.jsonl), `verify-hypothesis` (EXPERIMENT-NNN-ANALYSIS.md).
- `src/resources/extensions/gsd/auto.ts:3561-3593` — `diagnoseExpectedArtifact`. **Extend** with cases for new unit types.
- `src/resources/extensions/gsd/auto.ts:2992-3032` — `ensurePreconditions`. The includes array on line 3028 needs the new unit types added.
- `src/resources/extensions/gsd/dispatch-guard.ts:5-12` — `SLICE_DISPATCH_TYPES`. **Extend** with new unit types (they're slice-level work, same ordering constraint).
- `src/resources/extensions/gsd/auto.ts:2045-2359` — S04 builder functions. Ready to call — no changes needed.
- `src/resources/extensions/gsd/state.ts:462-513` — `deriveState` campaign detection block. **No changes needed** — returns `experimenting` phase, dispatch handles the rest.
- `src/resources/extensions/gsd/auto.ts:3227-3270` — `recoverTimedOutUnit` for `run-experiment`. **Extend** to handle new unit types (research-hypothesis needs no recovery beyond re-dispatch; execute-hypothesis gets the orphan revert logic; plan/verify just re-dispatch).
- `src/resources/extensions/gsd/nightshift-interview.ts:53-147` — `generateNightShiftScaffold`. Generates CAMPAIGN.json per slice. **No changes needed** — the scaffold already produces the right structure.

## Constraints

- **`deriveState()` is 614 lines with 33+ contract tests** — adding conditional paths risks subtle state bugs. The open question from M005-CONTEXT.md leans toward keeping deriveState unchanged and handling sub-phases in dispatch. This is the correct approach.
- **`handleAgentEnd` receives no agent output text** — only knows `currentUnit.type` and `currentUnit.id`. Plan agent output must be persisted to disk (EXPERIMENT-NNN-PLAN.md) by the agent itself, not captured from the session. The plan prompt must instruct writing to disk.
- **`buildExecuteExperimentPrompt` takes `experimentPlan` as a string parameter (D088)** — the execute builder reads the plan from its parameter, not from disk. But at dispatch time, the plan IS on disk (EXPERIMENT-NNN-PLAN.md). The execute dispatch reads the plan file and passes it to the builder. This reconciles D088 with persistence.
- **`buildVerifyExperimentPrompt` takes `currentResults` as a string parameter** — dispatch must assemble eval results into a string before building the verify prompt. The eval results come from `runExperimentPostProcess()` which returns an `ExperimentResult`.
- **Fresh session per unit** — each dispatch creates a new LLM context via `cmdCtx.newSession()`. No state carries between units except what's on disk.
- **Budget guards and MLOps hooks** — currently in `handleAgentEnd` for `run-experiment`. Must work correctly with the new unit types. Budget should be checked after `execute-hypothesis` (where the code change happens) or after `verify-hypothesis` (where analysis completes).
- **Crash recovery must work** — lock file enrichment with experimentNumber, orphan commit detection, timeout recovery all need to handle new unit types.

## Common Pitfalls

- **Plan agent output not persisted to disk** — If the plan prompt doesn't tell the agent to write EXPERIMENT-NNN-PLAN.md, the execute builder has no plan to inject. The S04 plan-experiment.md prompt does NOT instruct writing to a file — it just says "write your experiment plan as a structured response." **Must modify the plan-experiment.md prompt to also write to disk**, or have dispatch extract from the session. Writing to disk is the cleaner path since `handleAgentEnd` has no access to agent output text.
- **Eval results not available at verify dispatch time** — `runExperimentPostProcess` runs in `handleAgentEnd` for the execute unit. The verify unit dispatches in `dispatchNextUnit`. The eval result needs to survive between these two calls. **Persist formatted results to disk** (EXPERIMENT-NNN-RESULTS.md) or reconstruct from EXPERIMENT-LOG.jsonl at verify dispatch time.
- **Unit ID collision between sub-phases** — If all hypothesis sub-phases use `M001/S01` as their unitId, the idempotency keys will collide. **Include experiment number or sub-phase in the unitId**, e.g. `M001/S01/research`, `M001/S01/E001/plan`.
- **HYPOTHESIS-STATE.json and crash recovery race** — If process crashes between writing HYPOTHESIS-STATE.json and dispatching the next unit, state on restart must be consistent. Use atomic writes (D045 pattern).
- **`verifyExpectedArtifact` for `plan-hypothesis` needs experiment number** — The artifact path depends on which experiment number we're planning for. The unitId must encode this, e.g. `M001/S01/E001` so the verification function can construct `EXPERIMENT-1-PLAN.md`.

## Open Risks

- **Plan prompt modification (adding file-write instruction)** — S04's plan-experiment.md doesn't instruct writing to a file. Adding this instruction changes a verified S04 artifact. Must not break S04's 69 contract assertions. The modification is additive (adding a file path instruction, not removing content). Alternatively, the dispatch code could write the plan to disk after the agent completes, but `handleAgentEnd` doesn't have the output. **Risk: plan agent may not reliably write the file, causing stuck detection.** Mitigation: make the artifact check for `plan-hypothesis` lenient (check session output or always advance).
- **Verify agent receiving stale eval results** — If eval post-processing runs after `execute-hypothesis` ends but the result isn't persisted for verify dispatch, the verify agent gets nothing. Mitigation: reconstruct from the last EXPERIMENT-LOG.jsonl entry at verify dispatch time (read last line, parse JSON, format as markdown).
- **Token budget with four units per experiment** — Currently one `run-experiment` unit per experiment. Now four units per experiment (plan + execute + verify, plus once-per-hypothesis research). This 3-4x increase in dispatch overhead could hit budget ceilings faster. The per-experiment budget guard should check after execute (the expensive phase) and attribute all four units' costs to the experiment.
- **Backward compatibility** — Existing campaigns using `run-experiment` should keep working. The sub-phase dispatch should only activate for NightShift campaigns (those with hypothesis-native scaffold structure). Detection: check for absence of HYPOTHESIS-STATE.json or presence of a flag in CampaignConfig.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript state machine patterns | xstate skills searched | not relevant — internal state machine, not xstate |
| GSD auto.ts dispatch | project-internal | no external skill needed |

## Sources

- S04 Forward Intelligence: builder signatures, D088 execute builder takes experimentPlan, D087 readLatestExperimentAnalysis scans backwards (source: `.gsd/milestones/M005/slices/S04/S04-SUMMARY.md`)
- Dispatch pipeline: `dispatchNextUnit` at auto.ts:1143-1474, `handleAgentEnd` at auto.ts:596-723 (source: codebase exploration)
- State derivation: `deriveState` at state.ts:192-613, campaign detection at lines 462-513 (source: codebase exploration)
- Prompt templates: verify-experiment.md instructs writing EXPERIMENT-NNN-ANALYSIS.md, plan-experiment.md does NOT instruct writing to disk (source: prompt file reads)
- HYPOTHESIS-STATE.json pattern: modeled on AGENDA-STATE.json (D044/D045) — atomic write, crash-recoverable, per-slice state (source: `.gsd/DECISIONS.md` and `src/resources/extensions/gsd/agenda.ts`)
- NightShift scaffold: `generateNightShiftScaffold` produces per-slice CAMPAIGN.json with `maxExperiments` = `experimentsPerHypothesis` (source: `src/resources/extensions/gsd/nightshift-interview.ts:53-147`)
- CampaignConfig type: types.ts:280-302, no `hypothesisMode` flag yet — need detection mechanism (source: `src/resources/extensions/gsd/types.ts`)
