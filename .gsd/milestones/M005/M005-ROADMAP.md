# M005: Hypothesis-Driven Research Flow

**Vision:** Replace NightShift's single-prompt-per-experiment approach with a hypothesis-driven flow that leverages GSD's existing 4-agent infrastructure (research → plan → execute → verify). Each hypothesis gets genuine deep research. Each experiment within a hypothesis gets plan → execute → verify with accumulated results feeding forward. User-facing naming consistently says NightShift.

## Success Criteria

- `/nightshift` interview captures research setup and scaffolds GSD structure with hypothesis-slices and experiment-tasks
- `/nightshift auto` runs fully autonomously with each hypothesis getting a dedicated research phase
- Research agent demonstrably uses web search, library docs, and page fetching — not shallow one-search theater
- Verifier produces structured analysis that appears in next experiment's plan agent context
- All user-facing output says NightShift — no GSD or labrat leaking through
- Prompts are grounded in Karpathy's auto-research patterns

## Key Risks / Unknowns

- **Research depth vs token budget** — Deep research per hypothesis is the core value but burns tokens. If the research prompt isn't carefully designed, it'll either be shallow (useless) or blow the budget.
- **Per-experiment cycling** — GSD does plan-slice once then execute-task N times. We need plan→execute→verify per experiment within a hypothesis. This may require state machine changes.
- **Prompt quality** — The prompts ARE the product. Bad research prompts = shallow research theater, the user's worst-case outcome.

## Proof Strategy

- Research depth → retire in S04 by proving the research prompt produces multi-source, multi-step investigation (not single search)
- Per-experiment cycling → retire in S05 by proving plan→execute→verify dispatches correctly per experiment with accumulated context
- Prompt quality → retire in S06 by proving end-to-end flow produces informed hypotheses and learning between experiments

## Verification Classes

- Contract verification: prompt content inspection, scaffold structure validation, naming grep checks
- Integration verification: full hypothesis→experiment cycle with real eval command, real git, real web search
- Operational verification: crash recovery across new flow, budget guards
- UAT / human verification: user judges whether research feels genuinely deep vs theater

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 6 slices completed with verified outcomes
- `/nightshift` → interview → `/nightshift auto` produces complete hypothesis cycles
- Research agent uses web search / library docs / fetch_page per hypothesis (not just local file reads)
- Verifier analysis from experiment N is visible in experiment N+1's plan agent context
- All user-facing surfaces say NightShift consistently
- Crash recovery works across hypothesis→experiment flow
- Karpathy auto-research patterns are reflected in prompt design

## Requirement Coverage

- Covers: R042, R043, R044, R045, R046, R047, R048, R049
- Partially covers: none
- Leaves for later: R036–R039 (deferred compute backends), R021–R025 (out of scope)
- Orphan risks: none

## Slices

- [x] **S01: NightShift Naming Cleanup** `risk:low` `depends:[]`
  > After this: All prompts, CLI output, error messages, README, and examples say NightShift. Grepping for "GSD" or "labrat" in user-facing surfaces returns zero hits.

- [x] **S02: Karpathy Auto-Research Analysis** `risk:medium` `depends:[]`
  > After this: Structured research artifact with Karpathy's auto-research prompts, flow patterns, what works, what to adopt/avoid. Feeds directly into S04 prompt design.

- [x] **S03: /nightshift Interview & Scaffold** `risk:medium` `depends:[S01]`
  > After this: User runs `/nightshift`, answers research questions (targets, eval, metrics, priors, #hypotheses, #tries/hypothesis), gets GSD scaffold with hypothesis-slices and experiment-tasks. `/nightshift auto` can be started.

- [x] **S04: Hypothesis-Native Prompts** `risk:high` `depends:[S02,S03]`
  > After this: Each agent phase (research, plan, execute, verify) has research-tuned prompts. The research prompt instructs genuine deep search. The verify prompt produces structured analysis. Prompts are grounded in Karpathy analysis from S02.

- [ ] **S05: Learning Loop & State Flow** `risk:medium` `depends:[S04]`
  > After this: Verifier analysis feeds into next experiment's planner. State machine handles per-experiment plan→execute→verify cycling within a hypothesis. Crash recovery works across the new flow.

- [ ] **S06: End-to-End Integration** `risk:low` `depends:[S01,S02,S03,S04,S05]`
  > After this: Full `/nightshift` → interview → `/nightshift auto` → research → plan → execute → verify → next experiment → next hypothesis flow works end-to-end with real eval, real git, real web search.

## Boundary Map

### S01 → S03
Produces:
- Consistent NightShift naming in all prompts (system.md, run-experiment.md, etc.)
- Clean CLI output strings (error messages, help text)
- Updated README.md and examples

Consumes:
- nothing (first slice, parallel with S02)

### S02 → S04
Produces:
- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` — Karpathy auto-research analysis: prompt patterns, flow structure, what to adopt, what to avoid
- Concrete prompt fragments or patterns extracted from Karpathy's approach

Consumes:
- nothing (research-only slice, parallel with S01)

### S03 → S04
Produces:
- `/nightshift` command registration in commands.ts
- Interview flow that captures: targets, eval, metrics, priors, hypothesis count, tries/hypothesis
- GSD scaffold generation: roadmap with hypothesis-slices (generic placeholders H1..HN), plan with experiment-tasks
- CAMPAIGN.json (or equivalent) with hypothesis-native config

Consumes from S01:
- Clean naming in any generated scaffold text

### S04 → S05
Produces:
- `prompts/research-hypothesis.md` — Research agent prompt tuned for deep domain investigation
- `prompts/plan-experiment.md` — Plan agent prompt for forming/refining hypothesis approach
- `prompts/execute-experiment.md` — Execute agent prompt for target file modifications
- `prompts/verify-experiment.md` — Verify agent prompt that produces structured analysis
- Prompt builder functions in auto.ts for each new prompt type

Consumes from S02:
- Karpathy analysis informing prompt structure and content
Consumes from S03:
- Scaffold structure (what fields/config the prompts receive)

### S05 → S06
Produces:
- State machine dispatch logic for hypothesis→experiment cycling
- Per-experiment plan→execute→verify unit dispatch
- Verifier analysis persistence (written to disk, loaded by next experiment's planner)
- Context injection: prior experiment results + verifier analysis into plan agent prompt

Consumes from S04:
- All prompt templates and builders

### S06 (integration)
Produces:
- End-to-end proof that the assembled system works
- Any wiring fixes discovered during integration

Consumes from S01–S05:
- Everything
