# S07: CLI, Morning Report & Smoke Test — UAT

**Milestone:** M001
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed (artifact-driven for report formatting and eval pipeline, live-runtime for CLI commands, human-experience for full autonomous loop)
- Why this mode is sufficient: Report formatting and eval pipeline are deterministic and testable via artifacts. CLI commands need real execution to verify flag parsing and scaffold creation. The full autonomous loop with a real LLM requires human judgment on whether the loop produces useful results.

## Preconditions

- `npm run build` passes (clean compile)
- Python 3 available for eval scripts
- No active campaign in the test directory (clean state for `labrat report` empty-state tests)
- For full loop test (Test Case 6): LLM provider configured (e.g., `ANTHROPIC_API_KEY` set)

## Smoke Test

Run `node dist/cli.js report` in the project root. Should print "No active campaign found." and exit 0. If it crashes, something is fundamentally broken.

## Test Cases

### 1. Morning report with no campaign

1. `cd /tmp && mkdir -p labrat-uat-empty && cd labrat-uat-empty`
2. `node /home/claude/github/labrat/dist/cli.js report`
3. **Expected:** Prints "No active campaign found." to stdout, exits 0

### 2. Morning report with campaign data

1. Create test directory with campaign data:
   ```bash
   mkdir -p /tmp/labrat-uat-report/.gsd/milestones/M001/slices/S01
   echo '{"target_files":["train.py"],"eval_command":"python eval.py","metrics":[{"name":"val_bpb","direction":"min","weight":1}],"research_question":"Optimize training"}' > /tmp/labrat-uat-report/.gsd/milestones/M001/slices/S01/CAMPAIGN.json
   echo '{"experimentNumber":1,"description":"baseline","metrics":{"val_bpb":1.2},"compositeScore":0.5,"decision":"keep","timestamp":"2026-03-14T10:00:00Z","duration":30}' > /tmp/labrat-uat-report/.gsd/milestones/M001/slices/S01/EXPERIMENT-LOG.jsonl
   echo '{"experimentNumber":2,"description":"lower lr","metrics":{"val_bpb":1.0},"compositeScore":0.7,"decision":"keep","timestamp":"2026-03-14T10:05:00Z","duration":45}' >> /tmp/labrat-uat-report/.gsd/milestones/M001/slices/S01/EXPERIMENT-LOG.jsonl
   echo '{"experimentNumber":3,"description":"bad idea","metrics":{"val_bpb":1.5},"compositeScore":0.2,"decision":"discard","timestamp":"2026-03-14T10:10:00Z","duration":20}' >> /tmp/labrat-uat-report/.gsd/milestones/M001/slices/S01/EXPERIMENT-LOG.jsonl
   ```
2. `cd /tmp/labrat-uat-report && node /home/claude/github/labrat/dist/cli.js report`
3. **Expected:** Formatted report with:
   - Campaign header showing "Optimize training" and target files
   - Experiment summary: 3 total, 2 kept, 1 discarded
   - Top experiments ranked by composite score (E002 first at 0.7)
   - Improvement trajectory showing val_bpb improvement from 1.2 → 1.0

### 3. `labrat start --help` shows research flags

1. `node dist/cli.js start --help`
2. **Expected:** Help text includes `--target`, `--eval`, `--metric`, `--max-experiments`, `--budget-per-experiment` flags with descriptions

### 4. `labrat start` validates required flags

1. `node dist/cli.js start 2>&1; echo "EXIT:$?"`
2. **Expected:** Prints usage/error to stderr about missing required flags, exits 1
3. `node dist/cli.js start --target train.py 2>&1; echo "EXIT:$?"`
4. **Expected:** Prints error about missing `--eval` flag, exits 1

### 5. Karpathy eval pipeline

1. `python3 examples/karpathy-smoke/eval.py 2>/dev/null`
2. **Expected:** Single JSON line: `{"val_bpb": 0.91284, "train_loss": 0.839813}`
3. `python3 examples/karpathy-smoke/eval.py 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'val_bpb' in d and 'train_loss' in d and isinstance(d['val_bpb'],float)"`
4. **Expected:** Exits 0 (valid JSON with expected keys and types)
5. `bash examples/karpathy-smoke/verify.sh`
6. **Expected:** All checks pass with ✓ markers, final "PASS" message, exits 0

### 6. Full autonomous loop (manual UAT with real LLM)

1. Set up a test directory with `train.py`:
   ```bash
   mkdir -p /tmp/labrat-e2e && cd /tmp/labrat-e2e
   git init && git add -A && git commit -m "init" --allow-empty
   cp /home/claude/github/labrat/examples/karpathy-smoke/train.py .
   cp /home/claude/github/labrat/examples/karpathy-smoke/eval.py .
   git add . && git commit -m "add training scripts"
   ```
2. `node /home/claude/github/labrat/dist/cli.js start --target train.py --eval "python3 eval.py" --metric val_bpb:min:1.0 --max-experiments 3`
3. **Expected:**
   - Creates `.gsd/milestones/M001/slices/S01/CAMPAIGN.json` with correct config
   - Launches interactive mode
   - Auto-starts the experiment loop
   - Runs up to 3 experiments, each modifying `train.py` and evaluating
   - Experiments that improve `val_bpb` (lower is better) are kept; others are reverted
   - After completion, `node dist/cli.js report` shows results
4. **Expected report:** Shows experiment count, kept/discarded split, best val_bpb achieved

## Edge Cases

### Graceful handling of invalid flags

1. `node dist/cli.js report --bogus 2>&1; echo "EXIT:$?"`
2. **Expected:** No crash, exits 0 (unknown flags ignored for report)

### Report with NO_COLOR

1. `NO_COLOR=1 node dist/cli.js report` (in directory with campaign data from Test Case 2)
2. **Expected:** Report output contains zero ANSI escape codes (no `\x1b[` sequences)

### Eval script determinism

1. Run `python3 examples/karpathy-smoke/eval.py 2>/dev/null` twice
2. **Expected:** Identical output both times (hash-based metrics are stable)

### Metric changes when code changes

1. Modify a hyperparameter in `examples/karpathy-smoke/train.py` (e.g., change `learning_rate`)
2. Run `python3 examples/karpathy-smoke/eval.py 2>/dev/null`
3. **Expected:** `val_bpb` value differs from original 0.91284
4. Revert the change

## Failure Signals

- `labrat report` crashes with stack trace → morning report or campaign scanning broken
- `labrat report` shows 0 experiments when data exists → experiment log reading broken
- `labrat start --help` doesn't show `--target` → flag parsing not wired
- `labrat start` with valid flags doesn't create CAMPAIGN.json → scaffold creation broken
- `eval.py` outputs non-JSON or missing keys → eval contract broken
- `verify.sh` fails determinism check → hash-based metrics are unstable
- Build errors in `npm run build` → import extension fixes (.ts → .js) regressed

## Requirements Proved By This UAT

- R012 (CLI Commands) — Test Cases 1, 3, 4, 6 prove `start` and `report` subcommands work with flag parsing, help text, validation, and graceful error handling
- R013 (Terminal Morning Report) — Test Case 2 proves the morning report shows experiment summary, top experiments, improvement trajectory, and dashboard link from real campaign data

## Not Proven By This UAT

- Test Case 6 (full autonomous loop) requires a real LLM API key and manual human observation — it cannot be run in CI
- `labrat stop` and `labrat status` commands are not yet implemented (R012 lists them but they were not in S07 scope)
- Live MLOps dashboard integration during the autonomous loop (verified in S06 contract tests, not in S07 UAT)

## Notes for Tester

- Test Cases 1–5 are fully automated and can run without any LLM or API keys
- Test Case 6 requires an LLM provider key (e.g., `ANTHROPIC_API_KEY`) and takes several minutes depending on the model
- The Karpathy smoke test is intentionally trivial (~48ms per eval) so experiments complete quickly
- When running Test Case 6, watch for the experiment loop to keep/discard experiments — the metric should change between experiments since the LLM modifies `compute_loss()` or hyperparams
- Clean up `/tmp/labrat-uat-*` directories after testing
