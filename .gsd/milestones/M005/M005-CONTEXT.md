# M005: Hypothesis-Driven Research Flow — Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

## Project Description

NightShift is a research-oriented coding agent that runs overnight experiments autonomously. M001–M004 built the full infrastructure: eval pipeline, git state management, crash recovery, MLOps integration, compute backends, research agendas, runtime steering.

The problem: the experiment flow is a generic coder guessing blind. The agent gets a prompt saying "identify a change that could improve metrics" with no domain knowledge, no research, no structured hypothesis. It has no ML-specific skills — just frontend-design, swiftui, and debug-like-expert. The current `run-experiment` unit is a single prompt that reads the target files and experiment history, then blindly modifies code.

## Why This Milestone

The current flow wastes experiments on uninformed guesses. The agent needs to actively acquire domain knowledge before each hypothesis to make informed changes. GSD's existing 4-agent infrastructure (research → plan → execute → verify) is the perfect fit — it just needs research-tuned prompts and a hypothesis-native flow instead of the development-oriented one.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run `/nightshift`, answer a brief interview (targets, eval, metrics, priors, hypothesis count, tries/hypothesis), and the system scaffolds and starts autonomous research
- Watch `/nightshift auto` run hypotheses where each one gets genuine deep research (web search, library docs, domain investigation) before any code changes
- See experiments within a hypothesis building on each other — verifier analysis feeds into the next experiment's planning
- See consistent NightShift branding throughout — no GSD/labrat leaking through

### Entry point / environment

- Entry point: `/nightshift` command within pi interactive session, or `nightshift start` CLI
- Environment: local dev terminal
- Live dependencies involved: web search APIs (for research), eval commands (user-defined), git, optional MLOps (W&B/MLFlow), optional compute backends (SSH/Docker)

## Completion Class

- Contract complete means: prompts produce the right content, state machine dispatches correct units, naming is consistent
- Integration complete means: full hypothesis→experiment cycle works with real eval, real git, real web search
- Operational complete means: crash recovery works across new unit types, budget guards fire correctly

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `/nightshift` interview → auto-mode produces at least one complete hypothesis cycle (research → experiment with plan→execute→verify)
- Verifier analysis from experiment N is visible in experiment N+1's plan agent context
- Research agent demonstrably uses web search, library docs, or fetch_page — not just reads local files
- All user-facing output says NightShift, not GSD or labrat

## Risks and Unknowns

- **Research depth vs token budget** — Deep research burns tokens. Need to ensure the research prompt encourages genuine investigation without blowing per-experiment budgets.
- **Per-experiment plan→execute→verify cycling** — GSD's state machine does plan-slice once then execute-task N times. We need plan→execute→verify per experiment, which may require state machine changes or creative use of existing unit types.
- **Prompt quality** — Research-tuned prompts are the core deliverable. If the research prompt is shallow, the whole flow is shallow. Karpathy analysis (S02) de-risks this.

## Existing Codebase / Prior Art

- `src/resources/extensions/gsd/auto.ts` — State machine, unit dispatch, experiment prompt building. 3200+ lines. The core file to modify for state flow changes.
- `src/resources/extensions/gsd/state.ts` — Phase derivation (deriveState). Determines what unit to dispatch next based on disk state.
- `src/resources/extensions/gsd/guided-flow.ts` — Entry wizard, `/gsd` command routing, discuss/plan flows.
- `src/resources/extensions/gsd/commands.ts` — Command registration, subcommand routing. Where `/nightshift` command would register.
- `src/resources/extensions/gsd/prompts/run-experiment.md` — Current experiment prompt (single-shot, no research).
- `src/resources/extensions/gsd/prompts/system.md` — System prompt injected into all sessions. Says "GSD" extensively.
- `src/resources/extensions/gsd/prompts/research-slice.md` — Existing research agent prompt (development-oriented).
- `src/resources/extensions/gsd/prompts/plan-slice.md` — Existing plan agent prompt (development-oriented).
- `src/resources/extensions/gsd/prompts/execute-task.md` — Existing execute agent prompt (development-oriented).
- `src/resources/extensions/gsd/prompts/complete-slice.md` — Existing verify/complete agent prompt (development-oriented).
- `src/cli.ts` — CLI entry point, `nightshift start` command. Lines 310-424 handle campaign scaffolding.
- `src/loader.ts` — Process bootstrap, env vars, extension loading.
- `src/onboarding.ts` — First-run wizard. Already says NightShift.
- `examples/karpathy-smoke/` — Existing smoke test for experiment flow.
- `staged-prancing-emerson.md` — Original PRD (in Spanish). References labrat.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R042 — NightShift naming consistency (S01)
- R043 — Karpathy auto-research analysis (S02)
- R044 — /nightshift interview & scaffold (S03)
- R045 — Hypothesis-native prompts (S04)
- R046 — Deep research per hypothesis (S04)
- R047 — Verifier analysis & learning loop (S05)
- R048 — Hypothesis→experiment state flow (S05)
- R049 — End-to-end hypothesis flow (S06)

## Scope

### In Scope

- `/nightshift` command with research-oriented interview
- `/nightshift auto` using GSD's existing auto-mode with research-tuned prompts
- Hypothesis-native terminology in user-facing surfaces
- Research-tuned prompts for all 4 agent phases
- Deep research agent that uses full tool suite (web search, library docs, fetch_page)
- Verifier analysis that feeds into next experiment's context
- State machine adjustments for per-experiment plan→execute→verify cycling
- Naming cleanup: GSD/labrat → NightShift in user-facing surfaces
- Karpathy auto-research analysis to inform prompt design

### Out of Scope / Non-Goals

- Renaming internal code identifiers (src/resources/extensions/gsd/, @gsd/ imports)
- New eval pipeline logic (existing eval-runner.ts stays)
- New compute backends
- Changes to crash recovery core logic (just ensure it works with new unit types)
- ML-specific skills (the research agent acquires domain knowledge dynamically, not via bundled skills)

## Technical Constraints

- GSD's state machine is the backbone — work within it, don't replace it
- Auto-mode dispatches one unit at a time with fresh context per unit — the 4-agent-per-hypothesis pattern is emergent from the existing dispatch loop
- The extension directory stays as `src/resources/extensions/gsd/` — renaming it would break import paths throughout the codebase
- Prompts are Mustache-templated markdown files in `src/resources/extensions/gsd/prompts/`

## Integration Points

- **Web search tools** — Research agent uses search-the-web, fetch_page, resolve_library, get_library_docs
- **Eval pipeline** — eval-runner.ts runs user-defined eval commands, parses metrics
- **Git service** — git-service.ts handles commit/revert per experiment
- **State machine** — auto.ts dispatches units, state.ts derives phase
- **MLOps** — mlops-integration.ts logs to W&B/MLFlow
- **Compute backends** — compute-backend.ts, ssh-backend.ts, docker-backend.ts

## Open Questions

- **Per-experiment plan→execute→verify**: Does this require new unit types in the state machine, or can we reuse execute-task with a richer prompt that includes planning? — Leaning toward reusing existing unit types with prompt adjustments, since GSD already handles research-slice (once) then task cycling.
- **Hypothesis count fixed at start**: The interview asks for hypothesis count. Are these pre-named in the roadmap, or are they generic placeholders (H1, H2, ...) that the researcher fills in? — Likely generic placeholders since the researcher discovers what to explore.

## Key User Quotes / Emphasis

- "no necesitás 'what your vision' in nightshift, necesitás que arranque de una y organice bien lo que sabe, lo que ya probó, y lo que existe en internet"
- "más parecido a auto research, pero con la ventaja agéntica de gsd de research -> planner -> executor -> verifier por experimento por hipotesis de mejora"
- "tenés que aprovechar mejor el flujo de /gsd y de /gsd auto adentro de GSD"
- On what would disappoint most: "Shallow research theater" — the research phase MUST be genuinely deep
- Research must use the full tool suite every time, not just once at campaign start
