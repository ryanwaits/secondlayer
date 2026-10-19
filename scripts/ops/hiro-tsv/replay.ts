// Replay /new_block lines from a filtered Hiro TSV window straight into ingestNewBlock.
// usage: DATABASE_URL=... bun scripts/ops/hiro-tsv/replay.ts <window.tsv.zst> <lo> <hi> <stats.json>
import { ingestNewBlock } from "../../../packages/indexer/src/ingest.ts";

const [file, loArg, hiArg, statsPath] = process.argv.slice(2);
const ONLY = process.env.ONLY_HEIGHTS
	? new Set(process.env.ONLY_HEIGHTS.split(",").map(Number))
	: null;
const lo = Number(loArg);
const hi = Number(hiArg);
const proc = Bun.spawn(["zstd", "-dc", file], {
	stdout: "pipe",
	stderr: "ignore",
});
const reader = proc.stdout.getReader();
const dec = new TextDecoder();
let buf = "";
const t0 = Date.now();
const stats = {
	blocks_posted: 0,
	status: {} as Record<string, number>,
	txs: 0,
	events: 0,
	heights_seen: new Map<number, number>(),
	errors: [] as string[],
	elapsed_s: 0,
};

// Postgres COPY text format: backslash escapes in column values.
const COPY_ESC: Record<string, string> = {
	"\\": "\\",
	t: "\t",
	n: "\n",
	r: "\r",
	b: "\b",
	f: "\f",
	v: "\v",
};
export const unescapeStats = { other: 0 };
function unescapeCopy(s: string): string {
	if (s.indexOf("\\") < 0) return s;
	return s.replace(
		/\\([\\tnrbfv]|[0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g,
		(_m, c: string) => {
			if (c in COPY_ESC) return COPY_ESC[c];
			if (/^[0-7]+$/.test(c)) return String.fromCharCode(Number.parseInt(c, 8));
			if (c[0] === "x")
				return String.fromCharCode(Number.parseInt(c.slice(1), 16));
			unescapeStats.other++;
			return c;
		},
	);
}

async function handle(line: string) {
	const t1 = line.indexOf("\t");
	const t2 = line.indexOf("\t", t1 + 1);
	const t3 = line.indexOf("\t", t2 + 1);
	if (t3 < 0) return;
	if (line.slice(t2 + 1, t3) !== "/new_block") return;
	const payload = JSON.parse(unescapeCopy(line.slice(t3 + 1)));
	const h = payload.block_height as number;
	if (h < lo || h > hi) return;
	if (ONLY && !ONLY.has(h)) return;
	stats.heights_seen.set(h, (stats.heights_seen.get(h) ?? 0) + 1);
	try {
		const r = await ingestNewBlock(payload);
		stats.blocks_posted++;
		stats.status[r.status] = (stats.status[r.status] ?? 0) + 1;
		stats.txs += r.transactions;
		stats.events += r.events;
	} catch (e) {
		stats.errors.push(`${h}: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (stats.blocks_posted % 1000 === 0) {
		console.error(
			`${((Date.now() - t0) / 1000).toFixed(0)}s h=${h} blocks=${stats.blocks_posted} txs=${stats.txs} events=${stats.events}`,
		);
		flush();
	}
}

function flush() {
	stats.elapsed_s = (Date.now() - t0) / 1000;
	const dupHeights = [...stats.heights_seen]
		.filter(([, c]) => c > 1)
		.map(([h]) => h);
	Bun.write(
		statsPath,
		JSON.stringify(
			{
				...stats,
				heights_seen: stats.heights_seen.size,
				dup_heights: dupHeights.slice(0, 200),
				dup_count: dupHeights.length,
			},
			null,
			1,
		),
	);
}

while (true) {
	const { done, value } = await reader.read();
	if (done) break;
	buf += dec.decode(value, { stream: true });
	const lines = buf.split("\n");
	buf = lines.pop() ?? "";
	for (const line of lines) await handle(line);
}
if (buf.length) await handle(buf);
flush();
console.error(
	"DONE",
	JSON.stringify({ ...stats, heights_seen: stats.heights_seen.size }),
);
process.exit(0);
