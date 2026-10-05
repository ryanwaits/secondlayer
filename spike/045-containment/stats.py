#!/usr/bin/env python3
"""Per-block timing percentiles from processor logs.

Usage: stats.py <label> <log-file> [warmup=20] [take=380]

Reads the `{"bench":"block",...}` lines bench-preload.ts prints, drops the
first `warmup` blocks (cold JIT / connection setup), keeps the next `take`,
prints one JSON object. totalMs is rounded to whole ms by the processor, so
a p50 of a few ms has +-0.5ms resolution.
"""
import json
import statistics
import sys


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


label, path = sys.argv[1], sys.argv[2]
warmup = int(sys.argv[3]) if len(sys.argv) > 3 else 20
take = int(sys.argv[4]) if len(sys.argv) > 4 else 380

rows = []
with open(path) as fh:
    for line in fh:
        line = line.strip()
        if not line.startswith('{"bench"'):
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass

warm = rows[warmup : warmup + take]
out = {"label": label, "blocks_logged": len(rows), "warmup_dropped": warmup, "blocks_measured": len(warm)}
for key in ("totalMs", "handlerMs", "flushMs"):
    vals = sorted(r[key] for r in warm)
    out[key] = {
        "p50": pct(vals, 0.5),
        "p95": pct(vals, 0.95),
        "mean": round(statistics.fmean(vals), 2) if vals else None,
        "max": vals[-1] if vals else None,
    }
print(json.dumps(out))
