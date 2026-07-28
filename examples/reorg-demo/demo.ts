// Consumer-side reorg safety, made visible.
//
// `onBatch` and `onReorg` below are VERBATIM from ../sales-index/indexer.ts.
// The only additions are printing and a second `sales_naive` table written by
// the same handler but never rolled back — the indexer you get if you skip
// `onReorg`. Both tables read the same feed. Only one ends up correct.
//
// The frame is redrawn in place and kept under 80 columns, so the whole story
// is still on screen at the end — this is meant to be readable from the back
// of a room, not scrolled through afterwards.
import { Index } from "@secondlayer/sdk";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

interface Row {
	tx_id: string;
	cursor: string;
	block_height: number;
	buyer: string;
	collection: string;
	token_id: string;
}

interface Database {
	sales: Row;
	sales_naive: Row;
	checkpoints: { id: string; cursor: string };
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error(
		"DATABASE_URL is not set. Start the dev database with `bun run db` from the\n" +
			"repo root, then:\n\n" +
			"  export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer\n",
	);
	process.exit(1);
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
});

try {
	await sql`DROP TABLE IF EXISTS sales, sales_naive, checkpoints`.execute(db);
	await sql`
		CREATE TABLE sales (tx_id text PRIMARY KEY, cursor text, block_height int,
			buyer text, collection text, token_id text);
		CREATE TABLE sales_naive (LIKE sales INCLUDING ALL);
		CREATE TABLE checkpoints (id text PRIMARY KEY, cursor text NOT NULL);
	`.execute(db);
} catch (error) {
	const redacted = connectionString.replace(/:[^:@]*@/, ":***@");
	const detail = error instanceof Error ? error.message : String(error);
	console.error(
		[
			`\nCould not reach Postgres at ${redacted}`,
			`  ${detail}`,
			"",
			"Start it with `bun run db` from the repo root (it binds port 5440).\n",
		].join("\n"),
	);
	process.exit(1);
}

const B = "\x1b[1m";
const D = "\x1b[2m";
const RED = "\x1b[91m";
const GRN = "\x1b[92m";
const YEL = "\x1b[93m";
const R = "\x1b[0m";
/** Panel interior width. Two panels + gutters must stay under 80 columns. */
const W = 34;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `SP1BUYER...ALICE` → `ALICE`. The principals are only there to look real. */
const label = (principal: string) => principal.split("...").at(-1) ?? principal;

/** Narrative lines, kept and reprinted on every frame so nothing scrolls away. */
const story: string[] = [];

async function panel(table: "sales" | "sales_naive", title: string, c: string) {
	const rows = await db
		.selectFrom(table)
		.selectAll()
		.orderBy("block_height")
		.execute();
	const out = [
		`${c}${B}╔${"═".repeat(W)}╗${R}`,
		`${c}${B}║ ${title.padEnd(W - 2)} ║${R}`,
		`${c}${B}╠${"═".repeat(W)}╣${R}`,
	];
	for (const row of rows) {
		const buyer = label(row.buyer).padEnd(6);
		const plain = `  block ${row.block_height}   ${buyer}  ${row.token_id}`;
		const pad = " ".repeat(Math.max(0, W - plain.length));
		out.push(
			`${c}${B}║${R}  ${B}block ${row.block_height}${R}   ${buyer}  ${B}${row.token_id}${R}${pad}${c}${B}║${R}`,
		);
	}
	out.push(`${c}${B}╚${"═".repeat(W)}╝${R}`);
	return out;
}

/** Clear and redraw: header, the story so far, then the current frame. */
async function render(frame: string[]) {
	console.clear();
	console.log(
		`\n  ${B}sales-index${R} ${D}— every marketplace sale, in your own Postgres${R}\n`,
	);
	for (const line of story) console.log(line);
	if (story.length > 0) console.log("");
	for (const line of frame) console.log(`  ${line}`);
}

async function showOne(title: string, c: string, ms = 900) {
	await render(await panel("sales", title, c));
	await pause(ms);
}

const index = new Index({
	baseUrl: process.env.FAKE_INDEX_URL ?? "http://127.0.0.1:8899",
	// The fake chain wants no credential, and this machine may well have
	// `SL_API_KEY` exported for the other examples.
	apiKey: "",
});

await index.contractCalls.consume({
	contractId: "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4",
	functionName: "purchase-asset",
	fromHeight: 100,
	mode: "bounded",
	maxPages: 6,

	// ─── verbatim from ../sales-index/indexer.ts ─────────────────────────
	onBatch: async (calls, envelope, ctx) => {
		if (!ctx.cursor) return;
		await db.transaction().execute(async (tx) => {
			for (const call of calls) {
				if (call.status !== "success") continue;
				const [collection, tokenId] = call.args;
				const row = {
					tx_id: call.tx_id,
					cursor: call.cursor,
					block_height: call.block_height,
					buyer: call.sender,
					collection: String(collection),
					token_id: String(tokenId),
				};
				await tx
					.insertInto("sales")
					.values(row)
					.onConflict((oc) => oc.column("tx_id").doNothing())
					.execute();
				// The same write, to the table that has no `onReorg`.
				await tx
					.insertInto("sales_naive")
					.values(row)
					.onConflict((oc) => oc.column("tx_id").doNothing())
					.execute();
			}
			await tx
				.insertInto("checkpoints")
				.values({ id: "sales", cursor: ctx.cursor as string })
				.onConflict((oc) =>
					oc.column("id").doUpdateSet({ cursor: ctx.cursor as string }),
				)
				.execute();
		});
		if (calls.length > 0) {
			await showOne(
				`+${calls.length} sales  ·  tip ${envelope.tip.block_height}`,
				GRN,
			);
		}
		return ctx.cursor;
	},

	onReorg: async (reorg, ctx) => {
		story.push(
			`  ${RED}${B}⚡ REORG — the chain forked at block ${reorg.fork_point_height}${R}`,
		);
		await render(await panel("sales", "before rollback", D));
		await pause(1200);

		let deleted = 0n;
		await db.transaction().execute(async (tx) => {
			const result = await tx
				.deleteFrom("sales")
				.where("block_height", ">=", reorg.fork_point_height)
				.executeTakeFirst();
			deleted = result?.numDeletedRows ?? 0n;
			await tx
				.insertInto("checkpoints")
				.values({ id: "sales", cursor: ctx.cursor })
				.onConflict((oc) => oc.column("id").doUpdateSet({ cursor: ctx.cursor }))
				.execute();
		});

		story.push(
			`     ${RED}onReorg → DELETE ${deleted} rows ≥ block ${reorg.fork_point_height}${R}`,
		);
		story.push(`     ${D}checkpoint rewound to ${ctx.cursor}${R}`);
		await showOne("rolled back", YEL, 1100);
	},
	// ─────────────────────────────────────────────────────────────────────
});

const good = await panel("sales", "WITH onReorg  ✓ correct", GRN);
const bad = await panel("sales_naive", "WITHOUT onReorg  ✗ corrupt", RED);
const blank = " ".repeat(W + 2);
const frame: string[] = [];
for (let i = 0; i < Math.max(good.length, bad.length); i++) {
	frame.push(`${good[i] ?? blank}  ${bad[i] ?? ""}`);
}
frame.push("");
frame.push(`${D}Same feed. One handler.${R}`);
frame.push(`${D}The rows that never happened are gone.${R}`);
await render(frame);
console.log("");

await db.destroy();
process.exit(0);
