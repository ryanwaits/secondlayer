// Per-height compare: local DB semantic digests vs archive digest sidecar parquet.
// usage: DATABASE_URL=... bun scripts/ops/hiro-tsv/compare.ts <sidecar.parquet> <from> <to> <out.json>
import { localPerHeightDigests } from "../../../packages/cli/src/lib/archive-heights.ts";
import { readPartitionRows } from "../../../packages/cli/src/lib/parquet-rows.ts";
import { getDb } from "../../../packages/shared/src/db/index.ts";

const [sidecar, fromArg, toArg, outPath] = process.argv.slice(2);
const from = Number(fromArg);
const to = Number(toArg);
const t0 = Date.now();
type DigestRow = {
	height: number | bigint;
	block_digest: string;
	transactions_rollup?: string | null;
	events_rollup?: string | null;
};
const archive = new Map<number, DigestRow>();
for await (const r of readPartitionRows(
	Buffer.from(await Bun.file(sidecar).arrayBuffer()),
	"cmp",
)) {
	const row = r as unknown as DigestRow;
	const h = Number(row.height);
	if (h >= from && h <= to) archive.set(h, row);
}
const local = await localPerHeightDigests(getDb(), from, to);
const diffs: Record<string, number[]> = {
	block: [],
	transactions: [],
	events: [],
	missing_local: [],
	missing_archive: [],
};
for (let h = from; h <= to; h++) {
	const a = archive.get(h);
	const l = local.get(h);
	if (a && !l) {
		diffs.missing_local.push(h);
		continue;
	}
	if (l && !a) {
		diffs.missing_archive.push(h);
		continue;
	}
	if (!a) continue;
	if (a.block_digest !== l.block_digest) diffs.block.push(h);
	if ((a.transactions_rollup ?? null) !== l.transactions_rollup)
		diffs.transactions.push(h);
	if ((a.events_rollup ?? null) !== l.events_rollup) diffs.events.push(h);
}
const summary = Object.fromEntries(
	Object.entries(diffs).map(([k, v]) => [
		k,
		{ count: v.length, sample: v.slice(0, 30) },
	]),
);
console.log(
	JSON.stringify(
		{
			from,
			to,
			archive_rows: archive.size,
			local_rows: local.size,
			elapsed_s: (Date.now() - t0) / 1000,
			summary,
		},
		null,
		1,
	),
);
await Bun.write(outPath, JSON.stringify(diffs));
process.exit(0);
