# Project

## What This Is

Labrat is an autonomous research agent that turns AI from an interactive tool into a research collaborator that works while you sleep. It takes a research question and evaluation criteria, plans systematic exploration, executes time-boxed experiments autonomously, keeps what improves metrics, discards what doesn't, and produces a structured research log.

Built on GSD-2's infrastructure (crash recovery, cost/token tracking, timeout supervision, fresh context per unit, state machine, multi-provider LLM support), Labrat reshapes the development-oriented flow into a research-oriented one where failure is data, phases are theories, and the value is in accumulated knowledge about what works and what doesn't.

## Core Value

The autonomous experiment loop: modify target files → run eval → parse metrics → compare → keep/revert → repeat. Everything else supports this loop running reliably overnight.

## Current State

**M001 (Core Research Loop) complete.** All 15 requirements validated across 7 slices with 480 contract/integration tests passing.

**M002/S01 (Simplicity-Aware Evaluation & Multi-File Safety) complete.** Evaluation pipeline now factors in code simplicity via configurable diff-stat scoring (`simplicityWeight`), and catches out-of-scope file modifications with pre-eval revert. Both features default-off, backward-compatible with M001. 70 new contract tests (39 simplicity + 31 target validation). R017 and R019 validated.

**M002/S02 (Research Agenda Planning & Execution) complete.** `labrat plan` decomposes research questions into structured agendas with ordered phases. Campaigns with agendas execute phase-by-phase with boundary reassessment, phase-level baselines, and phase-specific experiment prompts. Agenda state survives process crash via atomic writes. 212 new contract tests (106 agenda + 61 execution + 45 plan-command). R016 and R020 validated. 19 total requirements validated.

The full research engine is operational: GSD-2 v2.10.6 rebranded as Labrat with dual-mode state machine (`experimenting` phase alongside development flow, triggered by CAMPAIGN.json). Eval pipeline handles subprocess execution with timeout, JSON metric parsing, multi-run median aggregation, direction-aware weighted composite scoring, and keep/discard decisions with automatic git revert. Research prompts deliver five-section fresh context per experiment with optional phase-aware context for agenda campaigns. Crash recovery detects and reverts orphan experiment commits on restart. Budget guards (per-experiment and campaign-level) pause before overspending. Live W&B and MLFlow REST integration with circuit breaker resilience. CLI (`labrat start`, `labrat plan`, `labrat report`) and 7-section terminal morning report operational.

Ready for M002/S03 (Runtime Steering).

## Architecture / Key Patterns

- **Base**: GSD-2 codebase (TypeScript, Node.js) with upstream tracking for selective cherry-picks
- **Hierarchy**: Campaign (Milestone) → Phase/Theory (Slice) → Experiment (Task)
- **State machine**: Disk-based, crash-recoverable, fresh LLM context per experiment
- **Evaluation**: User-defined shell command, JSON stdout, multi-metric with weighted composite scoring
- **Git strategy**: Branch per campaign, atomic commits per experiment, revert on discard
- **MLOps**: Live integration with W&B/MLFlow via REST API — Labrat logs orchestration metadata, user's eval scripts handle domain tracking natively
- **LLM providers**: Full multi-provider support inherited from GSD-2

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001: Core Research Loop — Autonomous experiment engine with eval, keep/discard, crash recovery, live MLOps integration, CLI, and morning report. 15 requirements validated. 480 tests.
- [ ] M002: Structured Research & Intelligence — Research agenda planning, simplicity-aware decisions, runtime steering, multi-file experiments, experiment sequencing
- [ ] M003: Upstream Sync & Ecosystem — Mechanism for analyzing and integrating GSD-2 upstream improvements into Labrat
