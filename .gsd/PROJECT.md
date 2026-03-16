# Project

## What This Is

Labrat is an autonomous research agent that turns AI from an interactive tool into a research collaborator that works while you sleep. It takes a research question and evaluation criteria, plans systematic exploration, executes time-boxed experiments autonomously, keeps what improves metrics, discards what doesn't, and produces a structured research log.

Built on GSD-2's infrastructure (crash recovery, cost/token tracking, timeout supervision, fresh context per unit, state machine, multi-provider LLM support), Labrat reshapes the development-oriented flow into a research-oriented one where failure is data, phases are theories, and the value is in accumulated knowledge about what works and what doesn't.

## Core Value

The autonomous experiment loop: modify target files → run eval → parse metrics → compare → keep/revert → repeat. Everything else supports this loop running reliably overnight.

## Current State

**M001–M004 complete.** 37 requirements validated across 24 slices. Core research engine, structured research intelligence, upstream sync, and remote compute backends all operational.

**M005 (Hypothesis-Driven Research Flow) complete.** All 6 slices done — R042–R049 validated. 313 hypothesis-specific assertions across 5 test files, 0 failures. Full `/nightshift` → interview → scaffold → research → plan → execute → verify → next experiment → next hypothesis flow proven end-to-end.

## Architecture / Key Patterns

- **Base**: GSD-2 codebase (TypeScript, Node.js) with upstream tracking for selective cherry-picks
- **Hierarchy**: Campaign (Milestone) → Phase/Theory (Slice) → Experiment (Task)
- **State machine**: Disk-based, crash-recoverable, fresh LLM context per experiment
- **Evaluation**: User-defined shell command, JSON stdout, multi-metric with weighted composite scoring
- **Git strategy**: Branch per campaign, atomic commits per experiment, revert on discard
- **MLOps**: Live integration with W&B/MLFlow via REST API — Labrat logs orchestration metadata, user's eval scripts handle domain tracking natively
- **Compute backends**: Pluggable `ComputeBackend` interface — LocalBackend (default), SSHBackend (native ssh + ControlMaster), DockerBackend (GPU passthrough). Git push syncs code before remote eval. Pre-flight checks + error wrapping → clean discards on failure.
- **LLM providers**: Full multi-provider support inherited from GSD-2

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001: Core Research Loop — Autonomous experiment engine with eval, keep/discard, crash recovery, live MLOps integration, CLI, and morning report. 15 requirements validated. 480 tests.
- [x] M002: Structured Research & Intelligence — Research agenda planning, simplicity-aware decisions, runtime steering, multi-file experiments, experiment sequencing. 5 requirements validated. 419 new tests.
- [x] M003: Upstream Sync & Ecosystem — Mechanism for analyzing, categorizing, applying, and LLM-adapting GSD-2 upstream improvements into Labrat. 1 requirement validated. 167 tests.
- [x] M004: Remote Compute Backends — Pluggable compute backend abstraction for eval dispatch. SSH and Docker backends with git code sync, pre-flight credential checks, backend error wrapping. 9 requirements validated. 254 tests.
- [x] M005: Hypothesis-Driven Research Flow — Replace single-prompt experiments with hypothesis-driven flow leveraging GSD's 4-agent pipeline. Deep research per hypothesis, plan→execute→verify per experiment, learning loop between experiments. NightShift naming cleanup. 8 requirements validated. 313 tests.
