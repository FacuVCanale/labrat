# S02: Research Agenda Planning & Execution

**Goal:** `labrat plan` decomposes a research question into a structured agenda with ordered phases and concrete experiment plans; campaigns with agendas execute phase-by-phase with boundary reassessment and phase-level baselines; agenda state survives process crash.
**Demo:** A campaign with a multi-phase agenda executes phase 1, reassesses at the boundary, then proceeds to phase 2 with the best result from phase 1 as the new baseline. `labrat plan` produces a valid structured agenda from an interactive discussion. Restarting a mid-phase campaign resumes from the correct phase and experiment.

## Must-Haves

- `agenda.ts` module with `AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState` types and pure functions (`parseAgenda`, `getCurrentPhase`, `advancePhase`, `writeAgendaState`, `readAgendaState`)
- `CampaignConfig` extended with optional `agenda?: AgendaConfig` field — M001-era configs still parse identically
- `AGENDA-STATE.json` file written to slice directory after every phase transition, crash-recoverable (write-to-temp-then-rename)
- Phase boundary detection in `dispatchNextUnit` — when current phase's experiments are exhausted, trigger reassessment then advance
- Phase-specific context injection in `buildExperimentPrompt` — current phase goals, dimension focus, phase-level best metrics
- `labrat plan` subcommand registered in `commands.ts`, adapting `showDiscuss` pattern
- `prompts/plan-agenda.md` template for LLM-driven agenda decomposition with JSON output schema
- `maxExperiments` remains the campaign hard ceiling — total experiments across all phases never exceeds it
- auto.ts net line count does not increase (all logic in agenda.ts, auto.ts gets thin wiring calls)
- All existing tests pass unchanged (backward compatibility)

## Proof Level

- This slice proves: contract + integration
- Real runtime required: no (LLM interaction tested via prompt assembly, execution flow tested with deterministic state)
- Human/UAT required: no (UAT deferred to milestone-level verification)

## Verification

- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — contract tests for agenda types, parsing, state persistence, phase transitions, backward compatibility, crash recovery (~50+ assertions)
- `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` — contract tests for phase boundary detection, phase context generation, phase-filtered history, phase-level best metrics (~30+ assertions)
- `npx tsx src/resources/extensions/gsd/tests/plan-command.test.ts` — contract tests for plan prompt assembly, agenda writing from structured output (~15+ assertions)
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — existing 33 tests still pass (backward compat)
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing 73 tests still pass
- `npm run build` — compiles clean
- Corrupt `AGENDA-STATE.json` recovery: `echo 'garbage' > /tmp/test-slice/AGENDA-STATE.json && npx tsx -e "..."` returns null (graceful degradation, stderr warning) — verified in agenda.test.ts corruption recovery test group
- Phase boundary failure path: `agenda-execution.test.ts` verifies that non-agenda campaigns produce identical prompts (no phase context injected), corrupt/missing agenda state degrades to global baseline, and phase advance on already-complete agenda is a no-op

## Observability / Diagnostics

- Runtime signals: `AGENDA-STATE.json` in slice directory tracks `currentPhaseIndex`, `phaseResults`, `experimentRanges` — readable state at any point
- Inspection surfaces: `jq '.agenda' CAMPAIGN.json` shows agenda structure; `jq '.' AGENDA-STATE.json` shows current phase progress; `jq '.phaseIndex' EXPERIMENT-LOG.jsonl` shows per-experiment phase attribution
- Failure visibility: Phase advance logged via `ctx.ui.notify` with phase name transitions; corrupt `AGENDA-STATE.json` recovers to phase 0 with stderr warning
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `simplicity-scorer.ts` module extraction pattern, `CampaignConfig` extension pattern, `showDiscuss` + `buildDiscussSlicePrompt` interactive flow pattern, `checkNeedsReassessment` phase boundary pattern
- New wiring introduced in this slice: `readAgendaState()` call in `dispatchNextUnit`, phase context injection in `buildExperimentPrompt`, phase advance in `handleAgentEnd`, `showPlan()` in `guided-flow.ts`, `plan` handler in `commands.ts`
- What remains before the milestone is truly usable end-to-end: S03 (runtime steering via `labrat discuss` → `STEERING.json`)

## Tasks

- [x] **T01: Agenda module with types, state persistence, and phase-transition functions** `est:40m`
  - Why: Foundation for all agenda-related functionality. Establishes types, pure functions, and state I/O that T02 and T03 depend on. Follows S01's module extraction pattern (D039).
  - Files: `src/resources/extensions/gsd/agenda.ts`, `src/resources/extensions/gsd/types.ts`, `src/resources/extensions/gsd/tests/agenda.test.ts`
  - Do: Create `agenda.ts` with all types (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`) and functions: `parseAgenda(config)` validates agenda structure, `getCurrentPhase(state, config)` returns active phase, `advancePhase(state, config, phaseMetrics)` transitions to next phase with metrics snapshot, `writeAgendaState(sliceDir, state)` uses write-to-temp-then-rename, `readAgendaState(sliceDir)` returns default state on missing/corrupt file. Add helper functions for T02: `shouldAdvancePhase(agendaState, phaseExperimentCount, phase)`, `getPhaseContext(agendaState, config)` formats phase-specific context string, `getPhaseBestMetrics(experiments, agendaState)` filters to current phase's kept results, `getPhaseFilteredHistory(experiments, agendaState)` returns experiments for current phase only. Extend `CampaignConfig` in types.ts with optional `agenda?: AgendaConfig`. AgendaState must include `version: 1` field for future migration. All write operations atomic (temp+rename).
  - Verify: `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — all assertions pass; `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — existing 33 tests still pass (backward compat)
  - Done when: agenda.ts exports all types and functions, tests prove parsing/validation/persistence/crash-recovery/phase-transitions/backward-compat, `npm run build` compiles clean

- [x] **T02: Phase-aware campaign execution wired through auto.ts and prompt template** `est:35m`
  - Why: Connects the agenda module to the experiment loop so campaigns with agendas execute phase-by-phase with boundary reassessment and phase-level baselines. This is where R020 (Experiment Dependency/Sequencing) becomes real.
  - Files: `src/resources/extensions/gsd/auto.ts`, `src/resources/extensions/gsd/prompts/run-experiment.md`, `src/resources/extensions/gsd/tests/agenda-execution.test.ts`
  - Do: In `dispatchNextUnit` (experimenting branch, ~line 1420): before building experiment prompt, call `readAgendaState(sliceDir)` and `shouldAdvancePhase()`. If phase boundary reached, call `advancePhase()` + `writeAgendaState()` + notify user. In `buildExperimentPrompt`: when agenda exists, call `getPhaseContext()` for phase-specific info, `getPhaseBestMetrics()` for phase-level baseline, `getPhaseFilteredHistory()` for phase-scoped history. Add `{{phaseContext}}` variable to `run-experiment.md` template (empty string when no agenda — no behavioral change for non-agenda campaigns). In `handleAgentEnd` (after experiment post-process): if agenda exists, record experiment's phase index in the log. Keep auto.ts changes to thin function calls — all logic stays in agenda.ts. Track net auto.ts line delta.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` — all assertions pass; `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — existing 73 tests still pass; `npm run build` compiles clean; auto.ts line count ≤ 3250
  - Done when: Phase boundary detection triggers phase advance, phase context appears in experiment prompts for agenda campaigns, non-agenda campaigns produce identical prompts to M001, auto.ts has not grown

- [x] **T03: `labrat plan` interactive command with prompt template and auto-start bridge** `est:25m`
  - Why: Delivers R016 (Research Agenda Planning) — the user-facing `labrat plan` command that runs an interactive discussion to decompose a research question into a structured agenda. Adapts the proven `showDiscuss` pattern.
  - Files: `src/resources/extensions/gsd/commands.ts`, `src/resources/extensions/gsd/guided-flow.ts`, `src/resources/extensions/gsd/prompts/plan-agenda.md`, `src/resources/extensions/gsd/tests/plan-command.test.ts`
  - Do: Add "plan" to subcommands array in `commands.ts` (line 59) and handler case calling `showPlan()`. Create `showPlan(ctx, pi, basePath)` in `guided-flow.ts` adapting `showDiscuss` pattern: guard checks (GSD project, active milestone, campaign config), build prompt with campaign context (research question, target files, eval config), dispatch via `dispatchWorkflow`. Create `plan-agenda.md` prompt template with JSON schema defining AgendaConfig structure — instruct LLM to write structured agenda into CAMPAIGN.json's `agenda` field. Include phase examples (dimension exploration, hyperparameter sweep, ablation study). Create `AGENDA-STATE.json` initialization after agenda is written. Add `checkAutoStartAfterPlan()` bridge that detects when agenda field appears in CAMPAIGN.json and starts auto-mode. Write contract tests for prompt assembly (correct context injection, variable substitution) and agenda output validation.
  - Verify: `npx tsx src/resources/extensions/gsd/tests/plan-command.test.ts` — all assertions pass; `npm run build` compiles clean; `labrat plan` appears in help text
  - Done when: `labrat plan` is registered and callable, prompt template includes JSON schema for agenda structure, auto-start bridge detects agenda write, tests prove prompt assembly and command registration

## Files Likely Touched

- `src/resources/extensions/gsd/agenda.ts` (new)
- `src/resources/extensions/gsd/types.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/commands.ts`
- `src/resources/extensions/gsd/guided-flow.ts`
- `src/resources/extensions/gsd/prompts/run-experiment.md`
- `src/resources/extensions/gsd/prompts/plan-agenda.md` (new)
- `src/resources/extensions/gsd/tests/agenda.test.ts` (new)
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` (new)
- `src/resources/extensions/gsd/tests/plan-command.test.ts` (new)
