---
id: T03
parent: S07
milestone: M001
provides:
  - "Karpathy smoke test harness — self-contained eval pipeline with deterministic metrics for UAT"
  - "verify.sh — pipeline validation without LLM dependency"
key_files:
  - examples/karpathy-smoke/train.py
  - examples/karpathy-smoke/eval.py
  - examples/karpathy-smoke/verify.sh
  - examples/karpathy-smoke/README.md
key_decisions:
  - "Metrics derived via SHA-256 hash of compute_loss() source + hyperparams repr — deterministic, changes when LLM modifies code"
  - "eval.py imports train.py directly for metrics rather than parsing stdout text — more reliable than string parsing"
  - "verify.sh includes determinism check (two runs, compare output) in addition to JSON format validation"
patterns_established:
  - "Eval wrapper pattern: run training script, import metrics function, output single JSON line to stdout, diagnostics to stderr"
observability_surfaces:
  - "eval.py stderr: training progress (epoch/loss/timing) + computed metrics summary"
  - "verify.sh: PASS/FAIL with per-check ✓ markers and specific failure reasons"
  - "Determinism: identical output on repeated runs confirms hash-based metrics are stable"
duration: 10m
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T03: Karpathy smoke test harness

**Created self-contained smoke test harness with deterministic hash-based metrics, eval wrapper producing parseMetrics()-compatible JSON, and pipeline verification script.**

## What Happened

Created `examples/karpathy-smoke/` with four files:

1. **train.py** — Simulates a training run in ~48ms. Computes `val_bpb` deterministically by SHA-256 hashing the source of `compute_loss()` and the `HYPERPARAMS` dict, mapping to a float in [0.80, 1.50]. Prints realistic epoch progress to stderr. When an LLM modifies the code (hyperparams, loss function), the metric changes.

2. **eval.py** — Runs `train.py` as subprocess (to verify it executes cleanly), then imports `get_deterministic_metrics()` directly for reliable metric capture. Outputs a single JSON line to stdout: `{"val_bpb": 0.91284, "train_loss": 0.839813}`. All diagnostics go to stderr. This matches the `parseMetrics()` contract (last JSON line, scanned bottom-up, numeric values only).

3. **verify.sh** — Validates the full pipeline: runs eval.py, checks JSON validity, verifies `val_bpb` and `train_loss` keys exist with finite numeric values, and confirms determinism by comparing two runs. Exits 0 with PASS or 1 with specific FAIL reason.

4. **README.md** — Documents the harness purpose, the `labrat start` one-liner for manual UAT, verification without LLM, and clarifies this tests loop machinery not research quality.

## Verification

Must-have checks — all passed:
- `python3 examples/karpathy-smoke/eval.py 2>/dev/null` → `{"val_bpb": 0.91284, "train_loss": 0.839813}` ✓
- JSON parseable by `parseMetrics()` (verified via python3 json.loads + key assertions) ✓
- `train.py` completes in 48ms (well under 2s limit) ✓
- Deterministic: two runs produce identical output ✓
- `bash examples/karpathy-smoke/verify.sh` → exits 0 with PASS ✓
- README includes `labrat start` one-liner ✓

Slice-level verification — all 6 checks pass:
- `npx tsx src/resources/extensions/gsd/tests/morning-report.test.ts` — 46 passed, 0 failed ✓
- `npm run build` — clean compile ✓
- `python3 examples/karpathy-smoke/eval.py` — valid JSON metrics ✓
- `node dist/cli.js report 2>&1 | head -5` — "No active campaign found" (no crash) ✓
- `node dist/cli.js start --help 2>&1 | grep -q target` — shows research flags ✓
- `node dist/cli.js report --bogus 2>&1` — exits 0, no crash ✓

## Diagnostics

- Run `python3 examples/karpathy-smoke/eval.py` to see raw JSON metrics on stdout and training diagnostics on stderr
- Run `bash examples/karpathy-smoke/verify.sh` to validate the full pipeline (JSON format, numeric values, determinism)
- Modify `train.py` (e.g., change a hyperparameter) and re-run eval.py to confirm metric changes

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `examples/karpathy-smoke/train.py` — deterministic training script with hash-based metrics
- `examples/karpathy-smoke/eval.py` — eval wrapper outputting parseMetrics()-compatible JSON
- `examples/karpathy-smoke/verify.sh` — pipeline validation script (executable)
- `examples/karpathy-smoke/README.md` — usage docs with labrat start one-liner
- `.gsd/milestones/M001/slices/S07/tasks/T03-PLAN.md` — added Observability Impact section
