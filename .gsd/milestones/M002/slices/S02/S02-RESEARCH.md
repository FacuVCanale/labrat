# S02: Research Agenda Planning & Execution — Research

**Date:** 2026-03-14

## Summary

S02 delivers two interlocking capabilities: (1) a `labrat plan` command that runs an interactive discussion to decompose a research question into a structured agenda with ordered phases and concrete experiment plans, and (2) phase-aware campaign execution where experiments run phase-by-phase with boundary reassessment and phase-level baselines, with agenda state surviving process crash.

The codebase is exceptionally well-prepared for this work. The `showDiscuss` + `buildDiscussSlicePrompt` pattern in `guided-flow.ts` provides a proven template for `labrat plan` — picker, inlined context, dispatch to LLM. `parseCampaignConfig` already validates only required fields and casts optional ones through, so `agenda` is a zero-change addition. The `checkNeedsReassessment` + assessment file pattern is directly reusable for phase boundary transitions. `compressExperimentHistory` is a pure function that can be extended with phase grouping. The module extraction pattern from S01 (`simplicity-scorer.ts`) establishes exactly how `agenda.ts` should be structured.

The primary risk is the interaction between agenda phases and `deriveState`. Currently, `countExperiments(sliceDir)` compares total experiments against `campaign.maxExperiments` to determine if the campaign is done. With phases, the concept of "done" becomes phase-relative — "this phase's experiments are exhausted" triggers reassessment and phase advance, not campaign termination. The `AGENDA-STATE.json` file must be readable by `deriveState` (or by `dispatchNextUnit` before prompt building) to determine the current phase's experiment allocation. The simplest approach: `AGENDA-STATE.json` tracks `currentPhaseIndex` and phases define `experimentsPerPhase`, while the global `maxExperiments` remains the hard ceiling across all phases.

## Recommendation

**Build in three layers: types + module → state integration → command registration.**

Layer 1: Create `agenda.ts` with all types (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`) and pure functions (`parseAgenda`, `getCurrentPhase`, `advancePhase`, `writeAgendaState`, `readAgendaState`). Extend `CampaignConfig` with optional `agenda?: AgendaConfig`. Write contract tests proving agenda parsing, phase transitions, state persistence, and backward compatibility. This layer has zero auto.ts changes.

Layer 2: Wire agenda awareness into `dispatchNextUnit` and `buildExperimentPrompt`. Phase boundary detection checks `AGENDA-STATE.json` to determine if the current phase's experiments are done, triggers reassessment, then advances to the next phase with updated baselines. Modify `compressExperimentHistory` to accept an optional phase filter. Extend `deriveState` to report phase progress in the `experiments` progress field. Write integration tests proving phase-by-phase execution flow.

Layer 3: Register `labrat plan` as a subcommand in `commands.ts`, create `prompts/plan-agenda.md`, and build the interactive discussion flow adapting the `showDiscuss` pattern. Wire `checkAutoStartAfterPlan` to bridge from plan discussion into auto-mode. This layer is the most prompt-engineering-heavy.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Interactive discussion flow for `labrat plan` | `showDiscuss()` + `buildDiscussSlicePrompt()` in `guided-flow.ts` | Proven pattern: picker → inlined context → dispatch prompt → LLM writes structured output. Same wizard UI, same `dispatchWorkflow` mechanism. |
| Phase boundary reassessment | `checkNeedsReassessment()` + assessment file in `auto.ts` | Checks for an assessment file, triggers reassessment unit if missing, writes assessment, continues. Identical pattern for phase boundaries. |
| Agenda state persistence | `CAMPAIGN.json` + `EXPERIMENT-LOG.jsonl` file-on-disk pattern | All state derives from disk files. `AGENDA-STATE.json` follows the same conventions — JSON file in slice directory, read by state derivation, crash-survivable. |
| Module extraction | `simplicity-scorer.ts` from S01 | Pure-function module with zero side effects (except I/O in read/write functions), called from auto.ts and eval-runner.ts. Same pattern for `agenda.ts`. |
| Optional CampaignConfig extension | S01's `simplicityWeight` field | Optional field, backward-compatible, passes through `parseCampaignConfig` shape validation unchanged. `agenda` follows the same pattern. |
| Structured LLM output | JSON schema in prompt template | The `run-experiment.md` prompt already constrains LLM output. `plan-agenda.md` will include a JSON schema for the agenda structure so the LLM produces parseable output. |
| Experiment history grouping | `compressExperimentHistory()` in `eval-runner.ts` | Already a pure function taking `ExperimentResult[]` → string. Adding a phase-grouping variant is incremental. |

## Existing Code and Patterns

- `src/resources/extensions/gsd/guided-flow.ts` — **Template for `labrat plan`**. `showDiscuss()` (line 377) shows a picker of non-done slices, builds a rich prompt with `buildDiscussSlicePrompt()`, dispatches via `dispatchWorkflow()`. `checkAutoStartAfterDiscuss()` (line 45) bridges discuss → auto-mode by watching for an output file. The `labrat plan` flow adapts all three patterns: picker (show agenda options), prompt builder (inline campaign context + research question), and auto-start bridge (start auto-mode after agenda is written).

- `src/resources/extensions/gsd/auto.ts` — **Four insertion points**: (1) `dispatchNextUnit()` at line 1420 where `experimenting` phase dispatches — add phase boundary detection before building the experiment prompt. (2) `buildExperimentPrompt()` at line 1945 — inject phase-specific context (current phase goals, dimension, phase baseline). (3) `handleAgentEnd()` at line 618 — after experiment post-processing, check if phase boundary is reached. (4) The reassessment pattern near line 1340 — insert phase reassessment check.

- `src/resources/extensions/gsd/state.ts` — **`parseCampaignConfig()` (line 60)** validates required fields only (`name`, `targetFiles`, `evalConfig`, `maxExperiments`, `budgetPerExperiment`). Optional fields pass through via `as CampaignConfig`. New `agenda` field requires zero changes here. **`deriveState()` (line 409)** uses `countExperiments(sliceDir)` and `campaign.maxExperiments` for phase transitions — needs to become agenda-aware (check `AGENDA-STATE.json` to distinguish phase completion from campaign completion).

- `src/resources/extensions/gsd/eval-runner.ts` — **`compressExperimentHistory()` (line 368)** is a pure function producing newest-first one-liner summaries. Needs a phase-aware variant that groups experiments by phase and dimension. **`readAllExperiments()` (line 336)** and **`readBestMetrics()` (line 292)** are used by `buildExperimentPrompt` — the phase-aware version needs to filter experiments by current phase for phase-level baselines.

- `src/resources/extensions/gsd/types.ts` — **Extension target**. `CampaignConfig` (line 240) gets `agenda?: AgendaConfig`. New types: `AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`. All follow existing type conventions (pure interfaces, no runtime dependencies).

- `src/resources/extensions/gsd/commands.ts` — **Subcommand registration**. `registerGSDCommand()` (line 54) lists subcommands at line 59 and has handler cases. `labrat plan` adds one entry to the subcommands array and one handler case calling `showPlan()` from `guided-flow.ts`. Tab completion already works via `getArgumentCompletions`.

- `src/resources/extensions/gsd/simplicity-scorer.ts` — **Module extraction reference**. 84 lines, pure functions, imported by `eval-runner.ts`. `agenda.ts` follows the same pattern but is larger (types + state I/O + phase transitions).

- `src/resources/extensions/gsd/prompts/run-experiment.md` — **Experiment prompt template**. Uses `{{variableName}}` substitution. For agenda-aware experiments, needs optional sections for phase context (current phase name, dimension focus, phase-level best metrics, experiments remaining in phase). These should be conditional — empty strings when no agenda is present.

- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — **Test pattern reference**. Uses `assert()`/`assertEq()`/`assertClose()` helpers, `mkdtempSync` for temp dirs, `rmSync` for cleanup. No test runner. Exit code signals pass/fail. New agenda tests follow the same pattern.

## Constraints

- **auto.ts must not grow.** Currently 3250 lines. All agenda logic (types, parsing, state transitions, phase management) must live in `agenda.ts`. auto.ts gets only thin wiring: one `readAgendaState()` call in `dispatchNextUnit`, one phase-context injection in `buildExperimentPrompt`, one phase-advance call in `handleAgentEnd`. Net auto.ts line delta should be near zero (add calls, don't add logic).

- **`deriveState` is the single source of truth.** Currently uses `countExperiments()` vs `maxExperiments` for the experimenting→summarizing transition. With phases, this must still work: campaign is "done" when all phases are complete AND total experiments reach the global max, or when the last phase's experiments are exhausted. The existing `experimenting` phase value must not change — it's checked in 14+ switch sites across auto.ts and other files.

- **CampaignConfig backward compatibility is mandatory.** `parseCampaignConfig` validates `name`, `targetFiles`, `evalConfig`, `maxExperiments`, `budgetPerExperiment` as required. The `agenda` field must be optional. Campaigns without agendas must work identically to M001 behavior. Proven by existing 33 derive-state tests still passing.

- **State must survive crash.** `AGENDA-STATE.json` written to disk after every phase transition. On restart, `readAgendaState()` returns the current phase, and `dispatchNextUnit` resumes from there. This follows the existing pattern: `CAMPAIGN.json` + `EXPERIMENT-LOG.jsonl` survive crashes because they're files on disk.

- **Experiment boundaries are the only safe intervention point.** Phase reassessment happens between experiments in `dispatchNextUnit`, never mid-experiment. Phase transition must complete atomically: write new `AGENDA-STATE.json` → next `dispatchNextUnit` call reads it.

- **Test infrastructure: pure TypeScript, no test runner.** New tests in `tests/agenda.test.ts` use `assert`/`assertEq` helpers, temp directories, process exit code. Must follow existing test patterns exactly.

- **Prompt template uses `{{variableName}}` substitution.** All variables must be string-typed. Complex objects (phase definition, experiment plans) must be formatted to strings before injection into the template. The prompt loader validates that all declared variables have values — missing variables throw.

- **`maxExperiments` is the campaign hard ceiling.** Even with phases, the total experiment count across all phases must not exceed `maxExperiments`. Phases can set `experimentsPerPhase`, but the global ceiling still triggers the `summarizing` transition in `deriveState`.

## Common Pitfalls

- **Growing auto.ts with phase logic** — The temptation is to add phase boundary checks inline in `dispatchNextUnit`. Instead, extract ALL phase logic to `agenda.ts`: `shouldAdvancePhase(agendaState, experimentCount) → boolean`, `getPhaseContext(agendaState, campaign) → string`, `advancePhase(agendaState) → AgendaState`. auto.ts calls these functions, doesn't implement them.

- **Breaking deriveState for non-agenda campaigns** — If `deriveState` starts reading `AGENDA-STATE.json` and the file doesn't exist (M001-era campaign), it must degrade to the existing `countExperiments >= maxExperiments` check. Test this explicitly: create a campaign without `agenda`, verify deriveState produces identical output to M001.

- **Phase baselines vs global baselines** — `readBestMetrics()` returns the latest kept experiment's metrics globally. For phase-level baselines, we need the best metrics from the CURRENT phase only. The simplest approach: filter `readAllExperiments()` by experiment ID range (phase start index to current), then find the best kept. Don't modify `readBestMetrics` — create a `readPhaseBestMetrics(sliceDir, phaseStartExp, currentExp)` in `agenda.ts`.

- **Agenda prompt quality cascading** — If `labrat plan` produces a poor agenda, every experiment inherits poor focus. Mitigate by: (1) structured JSON output schema constraining the LLM, (2) a review step where the user can edit the agenda before starting, (3) the reassessment mechanism at phase boundaries that can course-correct.

- **Experiment numbering across phases** — Experiments are numbered globally (exp-001, exp-002, ...) via `countExperiments(sliceDir)`. This must continue — don't restart numbering per phase. But `AGENDA-STATE.json` needs to track which experiment range belongs to each phase for filtering.

- **`labrat plan` auto-start timing** — `checkAutoStartAfterDiscuss()` watches for a context file to appear. `labrat plan`'s equivalent watches for the agenda to be written (either as part of `CAMPAIGN.json` or as `AGENDA.json`). The check must be specific — don't trigger on partial writes.

- **AGENDA-STATE.json partial write on crash** — If the process crashes mid-write of `AGENDA-STATE.json`, the file could be corrupt. Use write-to-temp-then-rename (same as D041 for STEERING.json). Also handle gracefully: if the file is unparseable, restart from phase 0 (safe default, like how `readBestMetrics` returns null on parse failure).

## Open Risks

- **Agenda decomposition quality is LLM-dependent** — The prompt for `labrat plan` asks the LLM to decompose a research question into meaningful phases and experiments. Quality varies by model. A bad decomposition (too vague, wrong dimensions, impractical experiments) cascades to every experiment. The structured JSON output schema constrains but doesn't guarantee quality. Phase boundary reassessment provides a correction mechanism but can't fix a fundamentally bad agenda.

- **deriveState complexity increase** — `deriveState` is already the most complex state derivation function (560 lines, 33 contract tests). Adding agenda-awareness increases conditional paths. The risk is introducing subtle state bugs that affect non-agenda campaigns. Mitigation: the minimal approach is to keep deriveState nearly unchanged and put phase logic in `dispatchNextUnit` instead (read `AGENDA-STATE.json` there, not in deriveState).

- **Phase-level `readBestMetrics` correctness** — When advancing to phase 2, the best metrics from phase 1's experiments become phase 2's baseline. But `readBestMetrics` reads the global best from JSONL. If phase 1's best experiment was reverted (discarded), the global best might be from an earlier keep — which is correct for the global campaign but wrong for the phase-level context. Need to decide: does phase 2 start from the globally best kept result, or from phase 1's best? The roadmap says "best result from phase 1 as the new baseline" — this requires phase-scoped metric reading.

- **Agenda state schema migration** — If the `AGENDA-STATE.json` format needs to change after some campaigns are already running with v1, we'll need backward-compatible parsing. Starting with a `version` field in the schema mitigates this.

- **`labrat plan` output format** — The plan command's LLM output needs to be machine-parseable (JSON for the agenda structure) while also being human-readable. If the LLM doesn't produce valid JSON, the plan fails. Using a structured output format (JSON code block in markdown, similar to how eval output works) with fallback parsing should handle this.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript state machine | (searched: xstate, execution-lifecycle) | none relevant — domain-specific to this codebase |

## Sources

- `src/resources/extensions/gsd/guided-flow.ts` — `showDiscuss()` (line 377), `buildDiscussSlicePrompt()` (line 299), `checkAutoStartAfterDiscuss()` (line 45) provide the proven template for interactive plan flow
- `src/resources/extensions/gsd/auto.ts` — `dispatchNextUnit()` (line 1137), `buildExperimentPrompt()` (line 1945), `handleAgentEnd()` (line 594), `checkNeedsReassessment()` (line 2370) are the four insertion points
- `src/resources/extensions/gsd/state.ts` — `parseCampaignConfig()` (line 60), `deriveState()` campaign detection (line 409), `countExperiments()` (line 88)
- `src/resources/extensions/gsd/eval-runner.ts` — `compressExperimentHistory()` (line 368), `readBestMetrics()` (line 292), `readAllExperiments()` (line 336), `runExperimentPostProcess()` (line 530)
- `src/resources/extensions/gsd/types.ts` — `CampaignConfig` (line 240), `ExperimentResult` (line 228), `ExperimentContext` (line 258)
- `src/resources/extensions/gsd/commands.ts` — `registerGSDCommand()` (line 54), subcommand routing
- `src/resources/extensions/gsd/simplicity-scorer.ts` — Module extraction reference (84 lines, pure functions)
- `src/resources/extensions/gsd/prompts/run-experiment.md` — Experiment prompt template with `{{variableName}}` substitution
- `src/resources/extensions/gsd/prompts/guided-discuss-slice.md` — Discussion prompt template for `labrat plan` adaptation
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — Test pattern reference (assert/assertEq, temp dirs, no test runner)
- M002 decisions: D038–D043 (simplicity scoring, module extraction, sequential phases, atomic writes, backward compat, target validation)
