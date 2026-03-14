# Project

## What This Is

Labrat is an autonomous research agent that turns AI from an interactive tool into a research collaborator that works while you sleep. It takes a research question and evaluation criteria, plans systematic exploration, executes time-boxed experiments autonomously, keeps what improves metrics, discards what doesn't, and produces a structured research log.

Built on GSD-2's infrastructure (crash recovery, cost/token tracking, timeout supervision, fresh context per unit, state machine, multi-provider LLM support), Labrat reshapes the development-oriented flow into a research-oriented one where failure is data, phases are theories, and the value is in accumulated knowledge about what works and what doesn't.

## Core Value

The autonomous experiment loop: modify target files → run eval → parse metrics → compare → keep/revert → repeat. Everything else supports this loop running reliably overnight.

## Current State

GSD-2 v2.10.6 merged and rebranded as Labrat. Full codebase builds clean. State machine extended with dual-mode operation: `experimenting` phase alongside existing development flow, triggered by CAMPAIGN.json presence. Research types defined (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscardDecision, CampaignConfig, ExperimentContext). Git experiment lifecycle (commit/revert) operational with greppable commit conventions. `run-experiment` unit type routed through all dispatch sites. Eval pipeline complete: subprocess execution with timeout, JSON metric parsing from mixed stdout, multi-run median aggregation, direction-aware weighted composite scoring, keep/discard decisions with git revert on discard, JSONL experiment log. handleAgentEnd wired to trigger eval post-processing for run-experiment units. Research prompts operational: `buildExperimentPrompt()` assembles five-section context (campaign overview, target files, best metrics, compressed history, instructions) with safety boundary enforcement. `extractDiffStat()` provides meaningful change descriptions. 186+ contract/integration tests across research flow, eval engine, prompt assembly, state machine, and dispatch. Next: experiment log crash recovery and supervision (S05), live MLOps integration (S06).

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

- [ ] M001: Core Research Loop — Adapt GSD-2 into a working autonomous experiment engine with eval, keep/discard, crash recovery, live MLOps integration, and CLI
- [ ] M002: Structured Research & Intelligence — Research agenda planning, simplicity-aware decisions, runtime steering, multi-file experiments, experiment sequencing
- [ ] M003: Upstream Sync & Ecosystem — Mechanism for analyzing and integrating GSD-2 upstream improvements into Labrat
