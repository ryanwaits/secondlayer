/**
 * Golden-fixture capture for the BlockSource re-point.
 *
 * Dumps raw `BlockData` (block + txs + events, exactly as the DB-tap loader
 * produces it) for a height range to a JSON fixture. This is the GROUND TRUTH
 * the HTTP-path reconstruction (`reconstruct.ts`) and the golden-diff harness
 * assert against — capturing it once means those tests need no live DB.
 *
 * Run against a populated DB (prod/staging):
 *   bun run packages/subgraphs/test/capture-fixtures.ts --from H1 --to H2 [--out dir]
 *
 * Pick a tight range that includes variety (ft/nft/print/stx events + an empty
 * block) so reconstruction is exercised across event shapes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSourceDb } from "@secondlayer/shared/db";
import { loadBlockRange } from "../src/runtime/batch-loader.ts";

function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
}

// Postgres bigint columns surface as bigint/string; normalize bigint → string
// so the fixture round-trips through JSON deterministically.
function replacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

async function main(): Promise<void> {
	const from = Number(arg("from"));
	const to = Number(arg("to"));
	const outDir = arg("out", join(import.meta.dir, "fixtures")) as string;
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
		console.error(
			"usage: bun capture-fixtures.ts --from H1 --to H2 [--out dir]",
		);
		process.exit(1);
	}

	const db = getSourceDb();
	const batch = await loadBlockRange(db, from, to);
	const blocks = [...batch.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([height, data]) => ({ height, ...data }));

	mkdirSync(outDir, { recursive: true });
	const file = join(outDir, `blockdata-${from}-${to}.json`);
	writeFileSync(file, `${JSON.stringify({ from, to, blocks }, replacer, 2)}\n`);

	const events = blocks.reduce((n, b) => n + b.events.length, 0);
	const txs = blocks.reduce((n, b) => n + b.txs.length, 0);
	const empty = blocks.filter((b) => b.events.length === 0).length;
	console.log(
		`wrote ${blocks.length} blocks (${txs} txs, ${events} events, ${empty} empty) → ${file}`,
	);

	await db.destroy();
}

void main();
