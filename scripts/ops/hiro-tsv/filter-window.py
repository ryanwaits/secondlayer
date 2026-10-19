# Filter a Hiro event-replay TSV to one height window, dropping mempool lines.
# usage: zstd -dc events.tsv.zst | python3 -I scripts/ops/hiro-tsv/filter-window.py <lo> <hi> <stats.json> | zstd > window.tsv.zst
import sys, re, time, json
LO, HI = int(sys.argv[1]), int(sys.argv[2])
stats_path = sys.argv[3]
H = re.compile(rb'"block_height":\s*(\d+)')
skip = {b'/new_mempool_tx', b'/drop_mempool_tx'}
counts = {}; active = False; past = 0; t0 = time.time(); n = 0; maxh = -1; nb = 0
out = sys.stdout.buffer
def dump():
    json.dump({"lines": n, "new_block_seen": nb, "max_height": maxh, "elapsed_s": time.time()-t0, "counts_in_window": counts}, open(stats_path, "w"), indent=1)
for line in sys.stdin.buffer:
    n += 1
    parts = line.split(b'\t', 3)
    if len(parts) < 4: continue
    path = parts[2]
    if path == b'/new_block':
        m = H.search(parts[3])
        h = int(m.group(1)) if m else -1
        if h > maxh: maxh = h
        nb += 1
        if not active and h >= LO: active = True
        if h > HI:
            past += 1
            if past >= 200: break
            continue
        if h < LO: continue
    if not active: continue
    key = path.decode()
    counts[key] = counts.get(key, 0) + 1
    if path in skip: continue
    out.write(line)
    if n % 100000 == 0:
        sys.stderr.write(f"{time.time()-t0:.0f}s lines={n} maxh={maxh}\n"); sys.stderr.flush(); dump()
dump()
sys.stderr.write("DONE\n")
