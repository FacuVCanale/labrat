# Karpathy Auto-Research Analysis — Research

**Date:** 2026-03-16

## Summary

Karpathy's `autoresearch` (github.com/karpathy/autoresearch, 36.9k stars, March 2026) is a radically minimal autonomous research system: one markdown prompt file (`program.md`) drives an AI agent through an infinite loop of code modification → training → evaluation → keep/discard on a single GPU training setup. The architecture has three files — `prepare.py` (fixed eval/data infrastructure), `train.py` (the only file the agent modifies), and `program.md` (the agent's operating instructions). The agent works on a dedicated git branch, commits each experiment, and either advances the branch (improvement) or git-resets (regression).

The core insight NightShift should adopt: **the prompt IS the product**. Karpathy's entire system is essentially a well-crafted markdown file that tells the agent how to behave. Everything else is standard git + subprocess execution. What NightShift adds that Karpathy completely lacks is a **research phase** — domain knowledge acquisition before experimentation, structured hypothesis formation, multi-agent specialization (research → plan → execute → verify), and a learning loop where analysis from experiment N feeds into experiment N+1. The absence of research in autoresearch is its biggest limitation and NightShift's biggest opportunity.

The second critical insight: Karpathy's **simplicity criterion** is extremely well-articulated and should be adopted almost verbatim into the verify prompt. The phrasing "0.001 improvement + 20 lines of hacky code? Probably not worth it. 0.001 improvement from deleting code? Definitely keep" is the right mental model for the verifier.

## Recommendation

Adopt Karpathy's prompt-centric philosophy and experiment loop mechanics while adding the multi-agent research depth that autoresearch completely lacks. Specifically:

1. **Research prompt** (new, no Karpathy equivalent): Instruct the agent to actively search the web, read library docs, understand domain techniques, and form a knowledge base before any code changes. This is NightShift's core differentiator — Karpathy's agent guesses from code alone.

2. **Execute prompt** (analogous to Karpathy's program.md loop body): Keep the tight modify → commit cycle. Adopt the "if you run out of ideas, think harder" spirit but with actual research tools.

3. **Verify prompt** (no Karpathy equivalent — autoresearch just checks val_bpb): Build structured analysis with Karpathy's simplicity criterion. Produce what worked, what didn't, what to signal to the next experiment.

4. **Plan prompt** (no Karpathy equivalent): Form concrete hypothesis approach based on research findings and prior experiment analysis.

Do NOT adopt Karpathy's flat single-agent model. The 4-agent specialization is NightShift's architectural advantage — the researcher can be deeply research-focused without also needing to be a coder, and the verifier can analyze without needing to implement.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Experiment loop mechanics | NightShift's existing `run-experiment` unit + eval-runner.ts | Already handles commit, eval, keep/discard, revert, JSONL logging, crash recovery — far more robust than Karpathy's bare git commands |
| Git state management | NightShift's git-service.ts | commitExperiment/revertExperiment already exist with safety checks |
| Experiment history compression | auto.ts `compressExperimentHistory()` | Already formats JSONL entries for prompt injection |
| Simplicity scoring | simplicity-scorer.ts from M002 | Already computes simplicity from diff-stat, just needs better prompt framing |
| Results logging | EXPERIMENT-LOG.jsonl | Crash-safe append-only log, more robust than Karpathy's untracked results.tsv |

## Existing Code and Patterns

- `src/resources/extensions/gsd/prompts/run-experiment.md` — Current experiment prompt. Good structure (campaign overview → target files → best metrics → history → instructions) but lacks research context. S04 should extend this pattern, not replace it.
- `src/resources/extensions/gsd/prompts/research-slice.md` — Existing research agent prompt template. Development-oriented but the inline-context injection pattern (`{{inlinedContext}}`, `{{dependencySummaries}}`) should be reused for hypothesis research.
- `src/resources/extensions/gsd/prompts/complete-slice.md` — Existing verify/complete agent prompt. The structure (inlined context → verification → summary) maps well to the verify-experiment flow.
- `src/resources/extensions/gsd/auto.ts` lines 1963–2041 — `buildExperimentPrompt()` assembles the run-experiment prompt from campaign config, target files, experiment history, best metrics, phase context, and steering context. The same assembly pattern should be extended for the four new prompt types.
- `karpathy/autoresearch/program.md` — The reference prompt to analyze. Key sections: Setup (branch, read files, verify data, initialize results), Experimentation (what you CAN/CANNOT do, the goal, simplicity criterion), Output format, Logging, The experiment loop (the LOOP FOREVER section), NEVER STOP directive.

## Constraints

- **Prompt templates are Mustache-templated markdown** in `src/resources/extensions/gsd/prompts/`. New prompts must follow the `{{variable}}` injection pattern.
- **Fresh context per agent dispatch** — each agent (researcher, planner, executor, verifier) gets a clean LLM context window with injected context. The research agent's findings must be persisted to disk so the planner can read them.
- **Token budget per agent** — deep research burns tokens. The research prompt must encourage genuine multi-step investigation without being so open-ended that it blows the per-unit budget. Karpathy sidesteps this by having no research phase at all.
- **Existing state machine** — new prompt types need corresponding unit types or must map to existing ones (research-slice, plan-slice, execute-task, complete-slice, run-experiment).
- **NightShift naming** — all user-facing text in prompts must say NightShift (S01 completed this cleanup).

## Common Pitfalls

- **Shallow research theater** — The user's worst-case outcome. If the research prompt just says "search for ways to improve," the agent will do one search and declare it done. The prompt must explicitly require multi-step investigation: search → read results → follow links → read library docs → synthesize. Name the tools (search-the-web, fetch_page, resolve_library, get_library_docs) in the prompt.
- **Over-specifying research steps** — The opposite extreme. If the prompt is a rigid 10-step procedure, the agent will mechanically follow it without genuine investigation. The prompt should specify the depth expectation ("at least 3 distinct sources") while leaving the agent free to follow productive threads.
- **Verify prompt producing only keep/discard** — Karpathy's approach reduces verification to "is val_bpb lower?" NightShift's verifier must produce structured analysis (what worked, what didn't, what to try next) that the planner can consume. The prompt must require this output format explicitly.
- **Ignoring the simplicity criterion** — Karpathy's simplicity language is effective because it gives concrete examples (0.001 improvement + 20 ugly lines vs. 0.001 improvement from deleting code). The verify prompt should adopt this style of concrete tradeoff reasoning, not abstract "consider simplicity."
- **Research findings lost between agents** — The researcher produces knowledge, but if it's only in the LLM's context (which gets wiped), the planner never sees it. Research findings must be written to a file on disk (e.g., `HYPOTHESIS-RESEARCH.md`) that gets inlined into the planner's context.

## Open Risks

- **Research depth vs. token budget tradeoff** — Genuine deep research (multiple web searches, reading full pages, library docs) can easily consume 50-80% of a unit's token budget. The research prompt must be efficient in guiding the agent to high-value sources without wasted exploration. No clear mitigation other than careful prompt iteration.
- **Research quality validation** — How do we verify that research is genuinely deep vs. theater? In S04, the prompt content can be inspected. In S06 integration, we need to verify the research agent actually calls web search tools, actually reads pages, actually synthesizes findings. This is a UAT/human-verification item.
- **Verifier analysis format** — The structured analysis (what worked, what didn't, what to try next) needs a format that the planner can reliably parse. If it's free-form prose, LLM-to-LLM communication is lossy. If it's too rigid (JSON schema), it's brittle. The right format is structured markdown with predictable headings — same approach as GSD's existing summary templates.

## Karpathy Auto-Research: Detailed Analysis

### Architecture

Karpathy's autoresearch has exactly three files:

| File | Role | Mutable? |
|------|------|----------|
| `prepare.py` | Data download, tokenizer training, dataloader, evaluation function (`evaluate_bpb`) | Fixed — agent cannot modify |
| `train.py` | GPT model, optimizer (MuonAdamW), training loop, hyperparameters | Agent's only target |
| `program.md` | Agent instructions — setup, loop definition, keep/discard rules, logging format | Human edits this to improve the "research org" |

The simplicity is deliberate: "The core idea is that you're not touching any of the Python files like you normally would as a researcher. Instead, you are programming the `program.md` Markdown files that provide context to the AI agents and set up your autonomous research org."

### The Experiment Loop (verbatim from program.md)

```
LOOP FOREVER:
1. Look at the git state: the current branch/commit we're on
2. Tune train.py with an experimental idea by directly hacking the code.
3. git commit
4. Run the experiment: uv run train.py > run.log 2>&1
5. Read out the results: grep "^val_bpb:|^peak_vram_mb:" run.log
6. If grep output is empty, the run crashed. Read tail -n 50 run.log.
7. Record the results in the tsv
8. If val_bpb improved (lower), advance the branch
9. If val_bpb is equal or worse, git reset back
```

### Key Design Principles

**1. NEVER STOP autonomy:**
> "Once the experiment loop has begun, do NOT pause to ask the human if you should continue. The human might be asleep... The loop runs until the human interrupts you, period."

**2. Fixed time budget makes experiments comparable:**
> "Training always runs for exactly 5 minutes, regardless of your specific platform. This makes experiments directly comparable regardless of what the agent changes."

**3. Simplicity criterion (the best-articulated part):**
> "All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. A 0.001 val_bpb improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 val_bpb improvement from deleting code? Definitely keep. An improvement of ~0 but much simpler code? Keep."

**4. Output suppression:**
> `uv run train.py > run.log 2>&1` — redirect everything, don't flood agent context.

**5. Crash handling with judgment:**
> "If it's something dumb and easy to fix (e.g., a typo, a missing import), fix it and re-run. If the idea itself is fundamentally broken, just skip it."

**6. When stuck — think harder (but no actual tools):**
> "If you run out of ideas, think harder — read papers referenced in the code, re-read the in-scope files for new angles, try combining previous near-misses, try more radical architectural changes."

### What NightShift Should ADOPT

| Pattern | Why | How to Adapt |
|---------|-----|-------------|
| Simplicity criterion phrasing | Concrete examples > abstract principles. The tradeoff language is effective. | Adopt near-verbatim into verify-experiment.md prompt |
| NEVER STOP directive | Essential for overnight autonomy | Already in NightShift's auto-mode, but reinforce in hypothesis prompts |
| Output suppression | Prevents eval output flooding agent context | Already handled by NightShift's subprocess-based eval-runner, but research prompt should avoid wasting context on tangential reads |
| Git as experiment state | Commit → advance or reset is clean | Already implemented in NightShift's git-service.ts |
| program.md as "skill" concept | The human's main lever is the prompt, not the code | Reinforces that NightShift's prompt files are the core deliverable of S04 |
| Fixed metric for comparability | Time-budgeted eval makes experiments comparable | Already in NightShift via eval timeout |
| "Think harder" when stuck | Agent should not give up | Adapt but ADD actual research tools (web search, docs) |

### What NightShift Should AVOID

| Anti-Pattern | Why It's Bad | NightShift Alternative |
|-------------|-------------|----------------------|
| No research phase | Agent guesses blindly from code alone — no domain knowledge, no web search, no papers | Full research agent with web search, library docs, page fetching per hypothesis |
| Flat experiment loop | No hypothesis structure, no grouping, no phases | Hypothesis → experiment hierarchy from GSD's slice → task mapping |
| Single agent for everything | No specialization — same agent researches, codes, evaluates | 4 specialized agents: research → plan → execute → verify |
| Raw TSV logging | No analysis of WHY things worked/failed, just numbers | Structured verifier analysis with what-worked / what-failed / what-to-try-next |
| No feedback between experiments | Each experiment starts fresh from just the numbers | Verifier analysis feeds into next experiment's planner context |
| Prompt-only safety | "What you CANNOT do" in prompt, no programmatic enforcement | NightShift has target file validation (M002), eval-is-automatic separation |
| No crash recovery | If process dies, manual intervention needed | NightShift has lock files, orphan detection, auto-resume |
| results.tsv untracked | Not committed, could be lost | EXPERIMENT-LOG.jsonl is the persistent record |

### Prompt Fragments for S04

These patterns from Karpathy's program.md should be adapted for NightShift's prompt templates:

**For research-hypothesis.md (NO Karpathy equivalent — NightShift's differentiator):**
The research prompt must explicitly name tools and set depth expectations. Karpathy's "think harder" is the closest analog but it only says "read papers referenced in the code." NightShift's research agent should:
- Search the web for techniques related to the research domain
- Read at least 3 distinct sources (papers, docs, implementations)
- Follow promising links to understand techniques deeply
- Synthesize findings into a structured knowledge summary
- Write findings to disk for the planner to consume

**For verify-experiment.md (adapt Karpathy's simplicity criterion):**
```
### Simplicity Criterion
All else being equal, simpler is better. When evaluating whether to keep a change:
- A marginal metric improvement that adds significant complexity? Probably not worth it.
- A marginal improvement from removing or simplifying code? Definitely keep.
- Similar metrics but substantially simpler code? Keep — that's a simplification win.
Weigh the complexity cost against the improvement magnitude.
```

**For execute-experiment.md (adapt Karpathy's loop discipline):**
```
### Experiment Discipline
- Make ONE focused change per experiment. Small, targeted modifications are more 
  informative than large rewrites.
- Explain your hypothesis: what you're changing and WHY you expect it to help,
  grounded in the research findings and prior experiment analysis.
- Do NOT run the eval command yourself — evaluation is automatic.
```

**For plan-experiment.md (NO Karpathy equivalent — NightShift's structured hypothesis formation):**
Karpathy has no planning phase — the agent just "tunes train.py with an experimental idea." NightShift's planner should:
- Read the research findings and prior experiment analysis
- Form a concrete, testable hypothesis with expected outcome
- Specify the exact change to make and WHY, grounded in research
- State what metric movement would confirm or refute the hypothesis
```
### Hypothesis Formation
Based on the research findings and prior experiment analysis, form a concrete hypothesis:
1. What specific change will you make?
2. Why do you expect it to improve the target metric, grounded in the research?
3. What metric movement would confirm this hypothesis?
4. What would refute it?
```

**For the NEVER STOP directive (all prompts):**
```
You are autonomous. Do NOT pause to ask the human — they may be asleep. 
If you run out of ideas, research harder: search the web, read documentation, 
study implementations. The loop continues until interrupted.
```

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Autonomous research agents | assafelovic/gpt-researcher@gpt-researcher | available — not installed (tangential, not directly relevant to prompt design) |
| Prompt engineering | davila7/claude-code-templates@senior-prompt-engineer | available — not installed (generic, NightShift prompts have specific patterns) |

No skills were installed. This slice is a research/analysis deliverable, not implementation. The relevant "technology" is Karpathy's autoresearch approach itself, analyzed from primary sources.

## Sources

- Karpathy's autoresearch architecture: three-file design, program.md as agent skill, git-based experiment state (source: [karpathy/autoresearch README](https://github.com/karpathy/autoresearch))
- The complete experiment loop, NEVER STOP directive, simplicity criterion, crash handling, logging format, setup procedure (source: [program.md — karpathy/autoresearch](https://raw.githubusercontent.com/karpathy/autoresearch/master/program.md))
- Training implementation showing what the agent modifies: GPT model, MuonAdamW optimizer, hyperparameters, all fair game (source: [train.py — karpathy/autoresearch](https://raw.githubusercontent.com/karpathy/autoresearch/master/train.py))
- Evaluation infrastructure showing fixed constraints: 5-min time budget, val_bpb metric, BPE tokenizer, dataloader (source: [prepare.py — karpathy/autoresearch](https://raw.githubusercontent.com/karpathy/autoresearch/master/prepare.py))
- NightShift's PRD describing autoresearch as inspiration and its limitations: single file, single metric, no crash recovery, no planning (source: `staged-prancing-emerson.md` — project PRD)
- NightShift's existing experiment prompt structure and assembly pattern (source: `src/resources/extensions/gsd/auto.ts` lines 1963–2041, `src/resources/extensions/gsd/prompts/run-experiment.md`)
