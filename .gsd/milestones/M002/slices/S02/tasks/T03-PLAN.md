---
estimated_steps: 5
estimated_files: 4
---

# T03: `labrat plan` interactive command with prompt template and auto-start bridge

**Slice:** S02 — Research Agenda Planning & Execution
**Milestone:** M002

## Description

Delivers R016 (Research Agenda Planning) — the user-facing `labrat plan` command. Adapts the proven `showDiscuss` + `buildDiscussSlicePrompt` + `checkAutoStartAfterDiscuss` pattern from `guided-flow.ts`. The plan command runs an interactive LLM discussion that decomposes a research question into a structured agenda with ordered phases, then writes it as the `agenda` field in `CAMPAIGN.json`. An auto-start bridge detects the agenda write and can trigger `labrat auto`.

The prompt template (`plan-agenda.md`) is the critical piece — it must constrain the LLM toward a JSON-parseable agenda structure with concrete experiment plans, while remaining flexible enough for diverse research questions. The template includes a JSON schema definition and examples so the LLM produces structured output.

## Steps

1. Register "plan" subcommand in `commands.ts`: Add `"plan"` to the subcommands array (line 59) so tab completion works. Add handler case `if (trimmed === "plan")` that calls `showPlan(ctx, pi, process.cwd())` imported from `guided-flow.ts`. Follow the exact pattern of the `discuss` handler.

2. Create `showPlan()` in `guided-flow.ts`: Adapt `showDiscuss` pattern — guard checks (GSD project exists, active milestone, at least one slice with `CAMPAIGN.json`). If multiple slices have campaigns, show picker. Build a rich prompt with `buildPlanPrompt(mid, sid, basePath)`: inline campaign config (research question, target files, eval config, current experiment history if any), milestone context, and decisions. Dispatch via `dispatchWorkflow(pi, prompt, "gsd-plan")`.

3. Create `prompts/plan-agenda.md` template: Structure the prompt with campaign context variables (`{{researchQuestion}}`, `{{campaignName}}`, `{{targetFileList}}`, `{{metricDefinitions}}`, `{{maxExperiments}}`, `{{existingContext}}`). Include the `AgendaConfig` JSON schema inline so the LLM produces parseable output. Instruct the LLM to: (a) discuss the research question and identify key dimensions to explore, (b) decompose into ordered phases where each phase focuses on one dimension, (c) allocate experiments per phase summing to ≤ maxExperiments, (d) write the agenda as `CAMPAIGN.json`'s `agenda` field. Include concrete examples of good agendas (hyperparameter tuning → architecture search → fine-tuning).

4. Add `checkAutoStartAfterPlan()` bridge in `guided-flow.ts`: Similar to `checkAutoStartAfterDiscuss` — detect when `CAMPAIGN.json` gains an `agenda` field (read file, check for `agenda` key). When detected, initialize `AGENDA-STATE.json` via `writeAgendaState` with phase 0, then trigger `startAuto`. Wire the check into `handleAgentEnd` alongside the existing discuss check.

5. Write contract tests in `tests/plan-command.test.ts`: Test prompt assembly (buildPlanPrompt produces correct context with all campaign fields, handles missing optional fields). Test agenda validation integration (plan-produced agenda structure passes `parseAgenda`). Test that "plan" appears in subcommands list. Test checkAutoStartAfterPlan detection (CAMPAIGN.json with agenda triggers, without agenda does not).

## Must-Haves

- [ ] `labrat plan` (or `/gsd plan`) registered as subcommand with tab completion
- [ ] `showPlan()` in guided-flow.ts with guard checks and campaign picker
- [ ] `plan-agenda.md` prompt template with JSON schema for AgendaConfig structure
- [ ] `checkAutoStartAfterPlan()` bridge detects agenda write and can start auto-mode
- [ ] AGENDA-STATE.json initialized when agenda is first detected
- [ ] Contract tests covering prompt assembly, command registration, auto-start bridge

## Verification

- `npx tsx src/resources/extensions/gsd/tests/plan-command.test.ts` passes with 15+ assertions
- `npm run build` compiles clean
- `grep -c '"plan"' src/resources/extensions/gsd/commands.ts` returns at least 1 (registered)

## Inputs

- `src/resources/extensions/gsd/guided-flow.ts` — `showDiscuss()`, `buildDiscussSlicePrompt()`, `checkAutoStartAfterDiscuss()` as patterns
- `src/resources/extensions/gsd/commands.ts` — subcommand registration pattern
- `src/resources/extensions/gsd/agenda.ts` — `parseAgenda`, `writeAgendaState` from T01
- `src/resources/extensions/gsd/prompts/guided-discuss-slice.md` — prompt template pattern reference

## Expected Output

- `src/resources/extensions/gsd/commands.ts` — "plan" added to subcommands and handler
- `src/resources/extensions/gsd/guided-flow.ts` — `showPlan()`, `buildPlanPrompt()`, `checkAutoStartAfterPlan()` added
- `src/resources/extensions/gsd/prompts/plan-agenda.md` — new prompt template
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — contract tests (15+ assertions)

## Observability Impact

- **New signal — `gsd-plan` custom message type:** When `/gsd plan` dispatches, a message with `customType: "gsd-plan"` appears in the agent message stream. This is visible in agent logs and confirms the plan flow was triggered.
- **CAMPAIGN.json agenda field:** After a successful plan session, `jq '.agenda' CAMPAIGN.json` shows the structured agenda. Absence means the plan session hasn't completed yet.
- **AGENDA-STATE.json initialization:** When `checkAutoStartAfterPlan` detects a new agenda, it writes `AGENDA-STATE.json` in the slice directory. `jq '.currentPhaseIndex' AGENDA-STATE.json` returns `0` immediately after initialization.
- **Auto-start bridge:** If auto-start triggers after plan, `startAuto` is called and the auto-mode logs will show experiment execution beginning. If the agenda is invalid (fails `parseAgenda`), the bridge silently waits — no auto-start, no error (the plan session is expected to fix it).
- **Failure visibility:** Invalid agenda in CAMPAIGN.json → `checkAutoStartAfterPlan` returns false (keeps waiting). No GSD project / no milestone / no campaign → `showPlan` shows a `ctx.ui.notify` warning. Already-has-valid-agenda → `showPlan` notifies user and returns without dispatching.
