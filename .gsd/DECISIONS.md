# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| D001 | M001 | arch | Starting point | GSD-2 codebase, not greenfield | GSD-2 has all the hard infrastructure (crash recovery, cost tracking, timeout, multi-provider LLM, state machine). Research logic is the new part. | No |
| D002 | M001 | arch | Hierarchy mapping | Campaign=Milestone, Phase=Slice, Experiment=Task | Inherit GSD-2's existing structure rather than inventing new abstractions. Same state machine, same file structure, same dispatch. | No |
| D003 | M001 | arch | Research flow semantics | Failure is data, phases are theories, advancement is exploration-driven | Fundamental difference from development flow. Failed experiments advance with knowledge, not block. | No |
| D004 | M001 | arch | MLOps integration strategy | Two-layer: Labrat logs orchestration via REST, eval scripts log domain metrics natively | User's eval scripts already live in Python where W&B/MLFlow SDKs are native. Labrat adds orchestration metadata via REST API. | Yes — if a TypeScript W&B SDK appears |
| D005 | M001 | pattern | Eval output format | JSON to stdout | Simple, parseable, language-agnostic. Eval prints {"metric": value} and Labrat parses it. | No |
| D006 | M001 | scope | Target file safety | Agent can only modify files explicitly specified by user | Eval script and infrastructure are immutable. Safety boundary prevents unintended modifications. | Yes — when multi-file experiments added in M002 |
| D007 | M001 | arch | Integration philosophy | Integrate existing tools, don't rebuild | Anything with a mature existing solution (MLOps tracking, visualization, statistical analysis) gets wired in, not reimplemented. Labrat's unique value is the autonomous research loop. | No |
| D008 | M001 | scope | LLM provider support | Keep full GSD-2 multi-provider support (20+) | Zero cost to maintain, inherited infrastructure. Users pick whatever model suits their research. | No |
| D009 | M001 | arch | Upstream tracking | Cherry-pick selective, not merge | Codebases will diverge. Cherry-pick infrastructure fixes from GSD-2, ignore development-specific changes. | No |
| D010 | M001/S01 | pattern | Integration branch | `dev` branch as integration target, not `main` | Slice branches branch from and merge into `dev`. `main` stays clean for releases. | No |
| D011 | M001/S01 | scope | Internal package naming | Keep `@gsd/*` workspace names and `gsd` extension directory unchanged | Renaming cascades into every import across 5 workspace packages for zero user-facing benefit. User-facing identity (package name, bin, env vars, config dir) is `labrat`. | Yes — if internal names cause confusion |
