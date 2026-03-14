---
id: T03
parent: S02
milestone: M002
provides:
  - showPlan() function for /gsd plan command with guard checks and campaign picker
  - buildPlanPrompt() function assembling campaign context into plan-agenda template
  - checkAutoStartAfterPlan() bridge detecting agenda writes and triggering auto-mode
  - plan-agenda.md prompt template with AgendaConfig JSON schema and examples
key_files:
  - src/resources/extensions/gsd/commands.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/prompts/plan-agenda.md
  - src/resources/extensions/gsd/index.ts
  - src/resources/extensions/gsd/tests/plan-command.test.ts
key_decisions:
  - Plan auto-start uses pendingPlanAutoStart stash pattern (same as pendingAutoStart for discuss) — stores ctx/pi/basePath/milestoneId/sliceId for deferred auto-start
  - checkAutoStartAfterPlan validates agenda via parseAgenda before initializing AGENDA-STATE.json — invalid agendas cause the bridge to silently wait
  - showPlan guards against re-planning when a valid agenda already exists — notifies user to remove agenda field manually first
patterns_established:
  - Second auto-start bridge alongside discuss — checkAutoStartAfterPlan runs in agent_end handler after checkAutoStartAfterDiscuss
  - Campaign-aware slice picker — showPlan finds slices with CAMPAIGN.json rather than all pending slices
observability_surfaces:
  - gsd-plan customType in dispatched message confirms plan flow triggered
  - CAMPAIGN.json agenda field presence/absence shows plan completion state
  - AGENDA-STATE.json initialization at phase 0 confirms auto-start bridge fired
  - ctx.ui.notify warnings for guard failures (no project, no milestone, no campaign, existing agenda)
duration: 20m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T03: `labrat plan` interactive command with prompt template and auto-start bridge

**Registered `/gsd plan` subcommand with campaign picker, plan-agenda.md prompt template with AgendaConfig JSON schema, and auto-start bridge that initializes AGENDA-STATE.json when agenda is written — 45 test assertions passing.**

## What Happened

1. **Command registration (commands.ts):** Added `"plan"` to subcommands array for tab completion. Added handler case calling `showPlan(ctx, pi, process.cwd())`. Updated usage message and description to include `plan`.

2. **showPlan() and buildPlanPrompt() (guided-flow.ts):** Adapted the `showDiscuss` pattern with campaign-specific guards: checks for GSD project, active milestone, roadmap, and at least one slice with `CAMPAIGN.json`. If multiple campaign slices exist, shows a picker. Guards against re-planning when a valid agenda already exists. `buildPlanPrompt()` inlines campaign config (research question, target files, metric definitions, max experiments, existing experiment count) plus milestone context and decisions into the `plan-agenda.md` template.

3. **plan-agenda.md prompt template:** Structured prompt with 7 template variables. Includes the complete `AgendaConfig` JSON schema inline so the LLM produces parseable output. Contains a concrete 3-phase example agenda. Interview protocol: clarifying questions → sketch confirmation → write to CAMPAIGN.json. Validation rules enforce experiment budget constraints.

4. **checkAutoStartAfterPlan() bridge (guided-flow.ts + index.ts):** Uses `pendingPlanAutoStart` stash (same pattern as discuss). On agent_end, checks if CAMPAIGN.json gained a valid agenda. If so, initializes AGENDA-STATE.json via `createInitialAgendaState` and triggers `startAuto`. Wired into `index.ts` agent_end handler alongside `checkAutoStartAfterDiscuss`.

5. **Contract tests (plan-command.test.ts):** 45 assertions across 6 groups: command registration, prompt template structure, prompt assembly via loadPrompt, agenda validation integration, auto-start bridge detection with AGENDA-STATE.json round-trip, and source-level export/wiring checks.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/plan-command.test.ts` — **45 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/agenda.test.ts` — **106 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/agenda-execution.test.ts` — **61 passed, 0 failed** ✓
- `npx tsx src/resources/extensions/gsd/tests/derive-state.test.ts` — **113 passed, 0 failed** ✓ (backward compat)
- `npx tsx src/resources/extensions/gsd/tests/eval-runner.test.ts` — **73 passed, 0 failed** ✓ (backward compat)
- `npm run build` — compiles clean ✓
- `grep -c '"plan"' commands.ts` — returns 2 ✓ (subcommands array + handler)

**All slice-level verification checks pass.** This is the final task in S02 — all checks green.

## Diagnostics

- **Plan flow triggered:** Look for `customType: "gsd-plan"` in agent message stream
- **Agenda written:** `jq '.agenda' <slice-dir>/CAMPAIGN.json` — null means plan hasn't completed
- **Auto-start fired:** `jq '.currentPhaseIndex' <slice-dir>/AGENDA-STATE.json` returns 0 after initialization
- **Guard failures:** `ctx.ui.notify` with "warning" level for: no GSD project, no milestone, no campaign, existing valid agenda

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/commands.ts` — Added "plan" to subcommands array, handler case, import, usage message, description
- `src/resources/extensions/gsd/guided-flow.ts` — Added `showPlan()`, `buildPlanPrompt()`, `checkAutoStartAfterPlan()`, `pendingPlanAutoStart` state, imports for parseCampaignConfig/parseAgenda/writeAgendaState/createInitialAgendaState/CampaignConfig
- `src/resources/extensions/gsd/prompts/plan-agenda.md` — New prompt template with AgendaConfig JSON schema, example agenda, interview protocol, validation rules
- `src/resources/extensions/gsd/index.ts` — Imported and wired `checkAutoStartAfterPlan` in agent_end handler
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — New test file with 45 assertions across 6 groups
- `.gsd/milestones/M002/slices/S02/tasks/T03-PLAN.md` — Added Observability Impact section (pre-flight fix)
