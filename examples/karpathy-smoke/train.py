#!/usr/bin/env python3
"""
Karpathy smoke test — trivially fast 'training' script.

This script simulates a training run that completes in under 1 second.
The key insight: val_bpb is derived deterministically from the code content
of this file. When an LLM modifies the code, the metric changes — some
modifications improve it, some don't.

Metric derivation:
  - Hash the source code of compute_loss() and the HYPERPARAMS block
  - Map the hash to a val_bpb in range [0.8, 1.5]
  - train_loss is derived from val_bpb with a fixed gap
"""
import hashlib
import inspect
import sys
import time

# ── Hyperparameters (LLM may tweak these) ──────────────────────────
HYPERPARAMS = {
    "learning_rate": 3e-4,
    "batch_size": 64,
    "n_layers": 4,
    "n_heads": 4,
    "n_embd": 128,
    "dropout": 0.1,
    "weight_decay": 0.01,
    "warmup_steps": 100,
    "max_steps": 1000,
}


def compute_loss(data, params):
    """
    Simulate a forward pass. The implementation here is intentionally
    simplistic — the LLM's job is to 'improve' it.

    The actual val_bpb is derived from a hash of this function's source
    and the hyperparams, so any code change produces a different metric.
    """
    total = 0.0
    for i, x in enumerate(data):
        # Simple weighted sum — room for 'optimization'
        w = params.get("learning_rate", 1e-3)
        total += x * w * (i + 1)
    return total / max(len(data), 1)


def get_deterministic_metrics():
    """Compute val_bpb deterministically from this file's code content."""
    # Hash the compute_loss source + hyperparams repr
    fn_source = inspect.getsource(compute_loss)
    hp_repr = repr(sorted(HYPERPARAMS.items()))
    content = fn_source + hp_repr

    h = hashlib.sha256(content.encode()).hexdigest()
    # Map first 8 hex chars to a float in [0.80, 1.50]
    hash_int = int(h[:8], 16)
    val_bpb = 0.80 + (hash_int % 10000) / 10000.0 * 0.70

    # train_loss is slightly lower than val_bpb (typical overfitting gap)
    train_loss = val_bpb * 0.92

    return round(val_bpb, 6), round(train_loss, 6)


def main():
    val_bpb, train_loss = get_deterministic_metrics()

    # Print realistic training noise to stderr
    print("=" * 50, file=sys.stderr)
    print("Karpathy smoke test — training run", file=sys.stderr)
    print(f"Config: {HYPERPARAMS}", file=sys.stderr)
    print("=" * 50, file=sys.stderr)

    for epoch in range(1, 4):
        # Simulate brief epoch with deterministic 'progress'
        t0 = time.monotonic()
        _dummy = sum(range(10000))  # tiny busy-work
        dt = time.monotonic() - t0
        epoch_loss = train_loss + (3 - epoch) * 0.02
        print(
            f"epoch {epoch}/3 | loss {epoch_loss:.4f} | "
            f"dt {dt*1000:.1f}ms",
            file=sys.stderr,
        )

    print(f"Final val_bpb: {val_bpb:.6f}", file=sys.stderr)
    print(f"Final train_loss: {train_loss:.6f}", file=sys.stderr)
    print("Training complete.", file=sys.stderr)

    # Return metrics for eval.py to capture
    return val_bpb, train_loss


if __name__ == "__main__":
    val_bpb, train_loss = main()
    # Only print metrics to stdout when run directly (not when imported)
    print(f"val_bpb={val_bpb} train_loss={train_loss}")
