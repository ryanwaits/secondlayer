/**
 * Local measurement harness (not run in CI): how much does a genesis reindex
 * of a contract-pinned, topic-filtered print subgraph pull from the Index, and
 * how much memory does the processor hold while doing it?
 *
 * Replays a synthetic chain from a FAKE Index server (a child process, so the
 * RSS sampled here is the processor's alone). Never calls a hosted API.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/secondlayer \
 *     bun packages/subgraphs/scripts/measure-reindex-overfetch.ts
 *
 * Tunables (env): CHAIN_TIP, BG_PRINTS_PER_BLOCK, BG_CONTRACTS, TARGET_EVERY,
 * PAYLOAD_BYTES. Prints one JSON line: rows the Index returned (what would
 * bill), peak/early/late RSS, sparse skips, wall time.
 */
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SubgraphContext } from "../src/runtime/context.ts";
import type {
	FakeIndexOptions,
	FakeIndexStats,
} from "../src/runtime/fake-index.ts";
import { reindexSubgraph } from "../src/runtime/reindex.ts";
import { generateSubgraphSQL } from "../src/schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../src/types.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const num = (k: string, d: number) => Number(process.env[k] ?? d);
const chain: FakeIndexOptions = {
	tip: num("CHAIN_TIP", 30_000),
	backgroundPrintsPerBlock: num("BG_PRINTS_PER_BLOCK", 40),
	backgroundContracts: num("BG_CONTRACTS", 200),
	targetContract: "SP000000000000000000002Q6VF78.pox-5",
	// pox-5 prints other topics now and then; the wanted topic at two heights.
	targetEvery: num("TARGET_EVERY", 2_000),
	otherTopic: "stack-stx",
	wantedTopic: "containment-probe",
	wantedHeights: [
		Math.floor(num("CHAIN_TIP", 30_000) / 3),
		2 * Math.floor(num("CHAIN_TIP", 30_000) / 3),
	],
	payloadBytes: num("PAYLOAD_BYTES", 300),
};

// Fake Index in its own process.
const child = Bun.spawn(
	[
		"bun",
		new URL("../src/runtime/fake-index.ts", import.meta.url).pathname,
		JSON.stringify(chain),
	],
	{ stdout: "pipe", stderr: "inherit" },
);
const reader = child.stdout.getReader();
let banner = "";
while (!banner.includes("\n")) {
	const { value, done } = await reader.read();
	if (done) throw new Error("fake index exited before READY");
	banner += new TextDecoder().decode(value);
}
const fakeUrl = banner.trim().replace(/^READY /, "");

process.env.SUBGRAPH_SOURCE = "streams-index";
process.env.SUBGRAPH_INDEX_API_URL = fakeUrl;

// Count sparse skips from the runtime's own log line.
let sparseSkips = 0;
for (const method of ["log", "info"] as const) {
	const original = console[method].bind(console);
	console[method] = (...args: unknown[]) => {
		if (args.some((a) => typeof a === "string" && a.includes("Sparse skip"))) {
			sparseSkips++;
		}
		original(...args);
	};
}

const db = getDb();
const id = randomUUID().slice(0, 8);
const name = `measure-overfetch-${id}`;
const pgSchema = `sg_measure_${id}`;
const def = {
	name,
	// No startBlock: genesis, like the live incident.
	sources: {
		probe: {
			type: "print_event",
			contractId: chain.targetContract,
			topic: chain.wantedTopic,
		},
	},
	schema: {
		probes: { columns: { tx_id: { type: "text" } } },
	} as unknown as SubgraphSchema,
	handlers: {
		probe: (async (_e: unknown, ctx: SubgraphContext) => {
			ctx.insert("probes", { tx_id: ctx.tx.txId });
		}) as unknown as SubgraphHandler,
	},
} as unknown as SubgraphDefinition;

for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
	await sql.raw(stmt).execute(db);
}
await db
	.insertInto("subgraphs")
	.values({
		name,
		status: "active",
		definition: def as unknown as Record<string, unknown>,
		schema_hash: "measure",
		handler_path: "measure",
		schema_name: pgSchema,
		account_id: randomUUID(),
		start_block: 1,
		last_processed_block: 0,
	} as never)
	.execute();

const rss: number[] = [];
const sampler = setInterval(() => rss.push(process.memoryUsage().rss), 25);
const started = performance.now();
try {
	await reindexSubgraph(def, { schemaName: pgSchema });
} finally {
	clearInterval(sampler);
}
const seconds = (performance.now() - started) / 1000;

const stats = (await (
	await fetch(`${fakeUrl}/__stats`)
).json()) as FakeIndexStats;
const { rows } = await sql
	.raw(`SELECT count(*)::int AS n FROM "${pgSchema}"."probes"`)
	.execute(db);
const mb = (b: number) => Math.round(b / 1024 / 1024);
const half = Math.floor(rss.length / 2);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.error(
	JSON.stringify({
		chainTip: chain.tip,
		bgPrintsOnChain: chain.tip * chain.backgroundPrintsPerBlock,
		indexRowsReturned: stats.rows,
		indexRowsTotal: stats.rows.events + stats.rows.blocks,
		indexRequests: stats.requests,
		unscopedEventRequests: stats.eventRequests.filter((r) => !r.contractId)
			.length,
		handlerRows: (rows as { n: number }[])[0]?.n,
		sparseSkips,
		rssMb: {
			peak: mb(Math.max(...rss)),
			firstHalfMean: mb(mean(rss.slice(0, half))),
			secondHalfMean: mb(mean(rss.slice(half))),
		},
		seconds: Math.round(seconds * 10) / 10,
	}),
);

await sql.raw(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`).execute(db);
await db.deleteFrom("subgraphs").where("name", "=", name).execute();
child.kill();
process.exit(0);
