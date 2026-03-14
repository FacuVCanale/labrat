# M002: Structured Research & Intelligence — Context

**Gathered:** 2026-03-13
**Status:** Pending (depends on M001)

## Project Description

After M001 delivers the core autonomous experiment loop, M002 adds the intelligence layer: structured research agendas, smarter keep/discard decisions that factor in code complexity, runtime steering to redirect mid-campaign, multi-file experiments, and experiment sequencing within phases.

## Why This Milestone

M001's free exploration mode ("just improve this metric") is powerful but undirected. Real research benefits from structured exploration — defining dimensions to investigate, planning experiments across those dimensions, and reassessing direction based on results. M002 transforms Labrat from a brute-force optimizer into a structured research partner.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run `labrat plan` to discuss a research question, define dimensions, and get a structured research agenda
- See the agent prefer simpler code when metric improvement is marginal (simplicity-aware keep/discard)
- Run `labrat discuss` in a separate terminal to redirect a running campaign based on intermediate results
- Define experiments that touch multiple files (e.g., modify both model architecture and training loop)
- Define experiment dependencies where later experiments build on earlier findings

### Entry point / environment

- Entry point: `labrat plan`, `labrat discuss`, `labrat auto`
- Environment: local dev (terminal)
- Live dependencies involved: Same as M001 plus richer prompt engineering for agenda planning

## Completion Class

- Contract complete means: agenda planning produces valid experiment plans, simplicity scoring works, steering updates the live queue
- Integration complete means: structured campaign runs end-to-end with agenda → experiments → reassessment loop
- Operational complete means: steering works while the loop is running without interrupting the current experiment

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A structured research agenda decomposes a multi-dimensional question into ordered experiments
- Simplicity-aware keep/discard correctly prefers simpler code when metric improvement is marginal
- `labrat discuss` successfully redirects a running campaign at the next experiment boundary
- A multi-file experiment modifies multiple targets and reverts all atomically on discard

## Risks and Unknowns

- **Simplicity scoring** — how to quantify code complexity meaningfully. Lines of code? Cyclomatic complexity? AST depth? Need to find a metric that correlates with actual simplicity, not just size.
- **Runtime steering latency** — the discuss command writes to disk, but the running loop reads at experiment boundaries. Latency between user input and effect could be confusing.
- **Agenda planning quality** — LLM needs to decompose a research question into meaningful dimensions and experiments. This is prompt engineering at its hardest.

## Existing Codebase / Prior Art

- Everything from M001 — the core loop, state machine, eval runner, MLOps integration
- GSD-2's discuss flow (`prompts/discuss.md`, `guided-flow.ts`) — adaptable for research agenda planning
- GSD-2's reassessment mechanism (`checkNeedsReassessment` in auto.ts) — adaptable for mid-campaign redirection

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R016 — Research agenda planning
- R017 — Simplicity-aware keep/discard
- R018 — Runtime steering
- R019 — Multi-file experiment scope
- R020 — Experiment dependency/sequencing

## Scope

### In Scope

- Discussion flow for capturing research question, dimensions, evaluation criteria
- Auto-decomposition of research question into structured experiment agenda
- Reassessment after experiment batches (adjust agenda based on findings)
- Simplicity-aware keep/discard with configurable weight
- `discuss` command for runtime steering
- Multi-file experiment scope with atomic revert
- Experiment dependency and sequencing within phases

### Out of Scope / Non-Goals

- Domain-specific templates (deferred further)
- Tree-based exploration (deferred further)
- Visualization beyond what MLOps platforms provide
- Notifications

## Technical Constraints

- Must build on M001's state machine and types without breaking the core loop
- Simplicity scoring must work for arbitrary code, not just Python/ML
- Runtime steering must be safe — no interrupting a running experiment mid-eval

## Integration Points

- **M001's experiment loop** — all M002 features wrap around or enhance the core loop
- **M001's MLOps integration** — agenda metadata should also be logged to W&B/MLFlow
- **LLM** — agenda planning and simplicity assessment both rely on LLM reasoning

## Open Questions

- Should simplicity scoring use an external tool (e.g., shell out to a complexity analyzer) or LLM judgment?
- How granular should runtime steering be — can the user reprioritize individual experiments, or only redirect at the phase level?
