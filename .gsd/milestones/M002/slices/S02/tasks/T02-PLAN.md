---
estimated_steps: 5
estimated_files: 4
---

# T02: Phase-aware campaign execution wired through auto.ts and prompt template

**Slice:** S02 — Research Agenda Planning & Execution
**Milestone:** M002

## Description

Wire the agenda module into the experiment loop so campaigns with agendas execute phase-by-phase. This is where R020 (Experiment Dependency/Sequencing) becomes real — experiments run within their assigned phase, phase boundaries trigger reassessment and advance, and phase-level baselines guide the LLM toward phase-specific goals.

The constraint is clear: auto.ts must not grow. All logic lives in `agenda.ts` functions — auto.ts adds only thin call sites (read state → check boundary → advance phase, inject phase context, record phase index). Three insertion points in auto.ts, one template change to `run-experiment.md`, and integration tests proving the flow.

Key design: `deriveState` stays unchanged. The global `maxExperiments` ceiling still triggers the `summarizing` transition. Phase transitions happen in `dispatchNextUnit` before prompt building — this avoids touching deriveState's 560 lines and 33 contract tests.

## Steps

1. Wire phase boundary detection into `dispatchNextUnit` (experimenting branch, ~line 1420): After computing `expNum`, read `AGENDA-STATE.json` via `readAgendaState(sliceDir)`. If agenda exists in campaign config but no state file, create initial state via `writeAgendaState`. Call `shouldAdvancePhase()` — if true, read best metrics for current phase via `getPhaseBestMetrics()`, call `advancePhase()` + `writeAgendaState()`, notify user via `ctx.ui.notify` with phase transition message. Then rebuild phase-aware context for the prompt.

2. Extend `buildExperimentPrompt` (~line 1945): When `config.agenda` exists, read `AgendaState`, call `getPhaseContext(state, config)` for phase-specific context block, `getPhaseBestMetrics(allExperiments, state)` for phase-level baseline (falls back to global baseline when no phase-level keeps), `getPhaseFilteredHistory(allExperiments, state)` for phase-scoped history. Pass the phase context as the `phaseContext` template variable. When no agenda, pass empty string — zero behavioral change.

3. Update `run-experiment.md` prompt template: Add a `{{phaseContext}}` section between "Campaign Overview" and "Target Files — Current Source". When populated, it shows: current phase name, phase goal/dimension, experiments remaining in phase, phase-level best metrics. When empty string (no agenda), the section is invisible.

4. In `handleAgentEnd` (after experiment post-process, ~line 618): After `appendExperimentLog`, if agenda exists, record the current phase index on the experiment result. This is informational — it enables phase-scoped filtering by `getPhaseFilteredHistory`.

5. Write integration tests in `tests/agenda-execution.test.ts`: Test phase boundary detection (shouldAdvancePhase returns true/false correctly with experiment counts), phase context generation (getPhaseContext produces correct markdown for different phases, empty string for no-agenda), phase-level metrics filtering (getPhaseBestMetrics returns only current phase's kept results), prompt template with phaseContext (non-empty for agenda, empty for non-agenda campaigns produces identical output to M001). Verify auto.ts line count has not increased.

## Must-Haves

- [ ] `dispatchNextUnit` reads `AGENDA-STATE.json` and detects phase boundaries
- [ ] Phase advance triggers `writeAgendaState` with updated phase index and metrics
- [ ] `buildExperimentPrompt` injects phase context when agenda exists
- [ ] `run-experiment.md` includes `{{phaseContext}}` variable — empty string for non-agenda campaigns
- [ ] Phase-level best metrics used as baseline when agenda is active
- [ ] Phase-scoped experiment history passed to prompt when agenda is active
- [ ] Non-agenda campaigns produce identical prompts and behavior to M001
- [ ] auto.ts net line delta is near zero (no growth)
- [ ] Existing eval-runner (73) and derive-state (33) tests pass unchanged

## Verification

- `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` passes with 30+ assertions
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` passes with 73 assertions (unchanged)
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` passes with 33 assertions (unchanged)
- `npm run build` compiles clean
- `wc -l src/resources/extensions/gsd/auto.ts` ≤ 3270 (near-zero growth from 3250)

## Observability Impact

- Signals added/changed: `ctx.ui.notify` message on phase transition ("Phase 1 → Phase 2: <phase name>"); `AGENDA-STATE.json` updated atomically with new phase index and phase results
- How a future agent inspects this: `jq '.' AGENDA-STATE.json` shows current phase; experiment prompt includes phase context section when agenda is active
- Failure state exposed: corrupt AGENDA-STATE.json triggers recovery to phase 0 with stderr warning; missing agenda in config degrades to global (non-phase) behavior

## Inputs

- `src/resources/extensions/gsd/agenda.ts` — all types and functions from T01
- `src/resources/extensions/gsd/auto.ts` — `dispatchNextUnit` (~line 1420), `buildExperimentPrompt` (~line 1945), `handleAgentEnd` (~line 618)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — existing template to extend
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments`, `readBestMetrics`, `compressExperimentHistory` functions

## Expected Output

- `src/resources/extensions/gsd/auto.ts` — thin wiring at three insertion points (~15 net lines added, offset by any cleanup)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — `{{phaseContext}}` variable added
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — integration tests (30+ assertions)
- `src/resources/extensions/gsd/agenda.ts` — may add small helper functions if T01's weren't sufficient
