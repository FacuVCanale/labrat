# Karpathy Smoke Test

A trivially fast "training" scenario that validates the full nightshift experiment loop **without** requiring actual ML training or an LLM.

## How It Works

- **`train.py`** — A Python script that simulates a training run in under 1 second. It computes a deterministic `val_bpb` metric derived from a hash of its own source code. When an LLM modifies the code (e.g., tweaks hyperparameters or the `compute_loss` function), the metric changes — some changes improve it, some don't.

- **`eval.py`** — Runs `train.py` and outputs a single JSON line to stdout:
  ```json
  {"val_bpb": 1.234, "train_loss": 1.135}
  ```
  Diagnostic output goes to stderr. This is the format `parseMetrics()` expects.

- **`verify.sh`** — Validates the eval pipeline works: runs eval.py, checks JSON format, verifies numeric values, and confirms determinism.

## Quick Start (with LLM)

Run a full 5-experiment campaign:

```bash
nightshift start \
  --target examples/karpathy-smoke/train.py \
  --eval 'python3 examples/karpathy-smoke/eval.py' \
  --metric 'val_bpb:min:1.0' \
  --max-experiments 5
```

**What to expect:** nightshift will run 5 experiments, each time asking the LLM to modify `train.py` to lower `val_bpb`. Some modifications will be kept (lower metric), some discarded (higher metric). At the end, run `nightshift report` to see a summary.

## Verify Without LLM

Validate that the eval pipeline works correctly — no LLM needed:

```bash
bash examples/karpathy-smoke/verify.sh
```

This runs `eval.py`, checks the JSON output format, verifies the values are finite numbers, and confirms determinism (two runs produce identical output).

## What This Tests

This smoke test validates the **loop machinery**, not LLM research quality:

- `eval.py` produces valid JSON metrics that `parseMetrics()` can consume
- The metric changes when code is modified (deterministic, not random)
- The full pipeline runs in under 2 seconds
- `nightshift start` can orchestrate the experiment loop end-to-end

It does **not** test whether the LLM produces meaningful research improvements — that requires real training code and real models.
