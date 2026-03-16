# S02: Karpathy Auto-Research Analysis — UAT

**Milestone:** M005
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S02 produces a static research document (no code, no runtime behavior). Verification is structural completeness of the artifact and its readiness for downstream consumption by S04.

## Preconditions

- Repository cloned and working directory is the project root
- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` exists
- `.gsd/REQUIREMENTS.md` exists

## Smoke Test

```bash
test -f .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo "Research artifact exists" || echo "MISSING"
```

## Test Cases

### 1. Research artifact has sufficient section depth

1. Run: `grep -c "## " .gsd/milestones/M005/slices/S02/S02-RESEARCH.md`
2. **Expected:** Returns ≥8 (actual: 19)

### 2. Architecture analysis covers Karpathy's three-file design

1. Run: `grep -q "prepare.py" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && grep -q "train.py" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && grep -q "program.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS || echo FAIL`
2. **Expected:** PASS — all three files from Karpathy's autoresearch repo are analyzed

### 3. Adopt table present with actionable patterns

1. Run: `grep -q "What NightShift Should ADOPT" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS || echo FAIL`
2. Scan the section for table rows (| Pattern | ... |)
3. **Expected:** PASS, with ≥5 rows covering patterns like simplicity criterion, NEVER STOP, output suppression, git state

### 4. Avoid table present with anti-patterns

1. Run: `grep -q "What NightShift Should AVOID" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS || echo FAIL`
2. Scan the section for table rows (| Anti-Pattern | ... |)
3. **Expected:** PASS, with ≥5 rows covering anti-patterns like no research phase, flat loop, single agent, no feedback

### 5. Prompt fragments section exists for S04 consumption

1. Run: `grep -q "Prompt Fragments for S04" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS || echo FAIL`
2. **Expected:** PASS

### 6. S02→S04 boundary contract: all 4 prompt types referenced

1. Run:
   ```bash
   grep -q "research-hypothesis.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && \
   grep -q "plan-experiment.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && \
   grep -q "execute-experiment.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && \
   grep -q "verify-experiment.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && \
   echo "ALL 4 PASS" || echo "MISSING PROMPT TYPE"
   ```
2. **Expected:** ALL 4 PASS — S04 can find concrete prompt fragments for every agent phase

### 7. Sources are cited with URLs

1. Run: `grep -c "source:" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md`
2. **Expected:** Returns ≥3 (actual: 6), including Karpathy's GitHub repo, program.md, train.py, prepare.py

### 8. R043 requirement is validated

1. Run: `grep "R043" .gsd/REQUIREMENTS.md | grep -q "validated" && echo PASS || echo FAIL`
2. **Expected:** PASS — R043 status is "validated" with concrete evidence

### 9. R043 is NOT still unmapped

1. Run: `grep "R043" .gsd/REQUIREMENTS.md | grep -q "unmapped" && echo "STILL UNMAPPED - FAIL" || echo "NOT UNMAPPED - PASS"`
2. **Expected:** NOT UNMAPPED - PASS

## Edge Cases

### Empty or truncated research artifact

1. If S02-RESEARCH.md is empty or <100 bytes, all section checks will fail
2. Run: `wc -c < .gsd/milestones/M005/slices/S02/S02-RESEARCH.md`
3. **Expected:** File is well over 1000 bytes (comprehensive research document)

### Adopt/avoid tables have content, not just headers

1. Run: `grep -A 1 "What NightShift Should ADOPT" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md | head -5`
2. **Expected:** Table content visible below the header, not an empty section

### Prompt fragments contain actionable text, not placeholders

1. Open S02-RESEARCH.md and navigate to the "Prompt Fragments for S04" section
2. Verify each subsection (research-hypothesis, plan-experiment, execute-experiment, verify-experiment) contains multi-line prompt text, not "TODO" or "placeholder"
3. **Expected:** Each fragment has concrete directive language that S04 can incorporate into actual prompt templates

## Failure Signals

- `grep -c "## "` returns <8 — major sections missing from research artifact
- Any of the 4 prompt type names missing — S02→S04 boundary contract broken
- `source:` count <3 — research not grounded in primary material
- R043 still shows "unmapped" or "active" — validation not completed
- Research artifact <500 bytes — likely empty or corrupted

## Requirements Proved By This UAT

- R043 — Karpathy Auto-Research Analysis: structured analysis exists with architecture, adopt/avoid tables, prompt fragments, and cited sources

## Not Proven By This UAT

- R045 — Whether the prompt fragments are actually good enough for S04 to build effective prompts (that's S04's validation)
- R046 — Whether the research prompt derived from this analysis produces genuinely deep investigation (that's S04+S06's validation)
- Runtime behavior — S02 is a pure research artifact with no code changes

## Notes for Tester

- This is a research-only slice — no code to run, no tests to execute. All verification is structural inspection of the research document.
- The key quality judgment is: "Can S04's planner read this file and extract concrete prompt patterns without further research?" Skim the prompt fragments section — if they feel specific and actionable (not vague handwaving), S02 did its job.
- The 6 cited sources should include Karpathy's actual GitHub repo and specific files (program.md, train.py, prepare.py), not generic blog posts.
