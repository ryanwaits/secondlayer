import { kyselySink } from "@secondlayer/sdk/sinks/kysely";
import { createStreamsClient } from "@secondlayer/sdk/streams";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
/**
 * Self-host smoke — proves a fresh `docker compose` install can actually do the
 * things the docs promise, with no hosted dependency and no service beyond the
 * ones in `docker/oss/docker-compose.yml`.
 *
 * Every feature that ships behind a server change gets a check here, because
 * "works against production" and "works against a cold volume an operator just
 * booted" are different claims. The gaps this caught on its first run were both
 * of the second kind: env vars wired into the hosted compose but not the OSS
 * one, and an opaque 500 on a chain that hasn't indexed a block yet.
 *
 * Usage:
 *   cd docker/oss && docker compose up -d --build postgres migrate api
 *   bun run scripts/self-host-smoke.ts
 *
 * Env:
 *   SMOKE_API_URL       default http://localhost:3800
 *   SMOKE_DATABASE_URL  default postgres://secondlayer:secondlayer@127.0.0.1:5432/secondlayer
 */
import { type Kysely, sql } from "kysely";
import { mintApiKey } from "../packages/api/src/auth/mint.ts";

const API = process.env.SMOKE_API_URL ?? "http://localhost:3800";
const DB_URL =
	process.env.SMOKE_DATABASE_URL ??
	"postgres://secondlayer:secondlayer@127.0.0.1:5432/secondlayer";

// STREAMS_INTERNAL_API_KEY is unset on a fresh OSS compose install, so the API
// seeds the internal-tier tenant under its hardcoded fallback literal
// (packages/indexer/src/decode/internal-auth.ts). That gives Streams reachable
// on a fresh install with no account, and — unlike the free tier — unlimited
// retention, which this smoke needs: it reads HEIGHT below, far outside the
// free tier's 1-day window.
const STREAMS_KEY = "sk-sl_streams_decode_internal";

const HEIGHT = 900_001;
/** Mirrors STREAMS_TIP_REORG_MARGIN_BLOCKS in packages/api/src/streams/tiers.ts. */
const TIP_MARGIN_BLOCKS = 2;
const TOKEN = "SP1SMOKE000000000000000000000000000TOKEN";
const TREASURY = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const HOLDER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const SUBGRAPH = "smoke";

/** The one table the sink leg writes — the operator's schema, not ours. */
type SmokeSinkDb = {
	smoke_sink_rows: { cursor: string; recipient: string; height: number };
};

const HANDLER_CODE = `import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "${"smoke"}",
  schema: { transfers: { columns: { amount: { type: "uint" }, recipient: { type: "principal" } } } },
  sources: { t: { type: "ft_transfer" } },
  startBlock: ${900_001},
  handlers: {
    t: (event, ctx) => {
      ctx.insert("transfers", { amount: event.amount, recipient: event.recipient });
    },
  },
});
`;

let failures = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
	if (ok) {
		console.log(`  ✓ ${name}`);
		return;
	}
	failures++;
	console.log(`  ✗ ${name}`);
	if (detail !== undefined) {
		console.log(`      ${JSON.stringify(detail).slice(0, 400)}`);
	}
}

/** Untyped by design — this asserts against the wire, not our own types. */
type JsonValue = Record<string, unknown> | unknown[] | string | null;
type HttpResult = { status: number; body: JsonValue };

/** Read a nested field off a wire body without pulling in server types. */
function field(body: JsonValue, path: string): unknown {
	let cur: unknown = body;
	for (const key of path.split(".")) {
		if (cur === null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

async function get(path: string, key?: string): Promise<HttpResult> {
	const res = await fetch(`${API}${path}`, {
		headers: key ? { Authorization: `Bearer ${key}` } : {},
	});
	const body = await res.text();
	try {
		return { status: res.status, body: JSON.parse(body) };
	} catch {
		return { status: res.status, body };
	}
}

/**
 * Provision (or reuse) the local owner account and mint a key — the same path
 * `scripts/oss-bootstrap.ts` gives an operator, inlined so the smoke is one
 * command.
 */
async function bootstrapKey(db: Kysely<Database>): Promise<string> {
	const existing = await db
		.selectFrom("accounts")
		.select(["id"])
		.where("email", "=", "owner@localhost")
		.executeTakeFirst();
	const account =
		existing ??
		(await db
			.insertInto("accounts")
			.values({
				email: "owner@localhost",
				ghost: false,
				display_name: "Self-hosted owner",
			})
			.returning(["id"])
			.executeTakeFirstOrThrow());
	const minted = await mintApiKey(db, {
		accountId: account.id,
		name: "self-host smoke",
		product: "account",
		ip: "127.0.0.1",
	});
	return minted.key;
}

async function post(
	path: string,
	body: unknown,
	key: string,
): Promise<HttpResult> {
	const res = await fetch(`${API}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			Authorization: `Bearer ${key}`,
		},
		body: JSON.stringify(body),
	});
	const text = await res.text();
	try {
		return { status: res.status, body: JSON.parse(text) };
	} catch {
		return { status: res.status, body: text };
	}
}

async function main() {
	const db = getDb(DB_URL);

	console.log("\nSelf-host smoke");
	console.log(`  api ${API}`);

	// ── 0. The stack is up and migrated ────────────────────────────────
	console.log("\nstack");
	const health = await get("/health");
	check("api answers /health", health.status === 200, health.body);

	const tables = await sql<{ table_name: string }>`
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public'
	`.execute(db);
	const names = new Set(tables.rows.map((r) => r.table_name));
	for (const t of ["blocks", "events", "decoded_events", "chain_read_cache"]) {
		check(`migrated: ${t}`, names.has(t));
	}

	// ── 1. Empty chain reports itself, rather than 500-ing ─────────────
	// Only meaningful before anything is indexed, so it is skipped once the
	// stack has blocks — a re-run on a seeded install shouldn't fail here.
	console.log("\nempty chain");
	const anyBlock = await sql<{ n: string }>`
		SELECT count(*)::text AS n FROM blocks WHERE canonical = true
	`.execute(db);
	if (anyBlock.rows[0]?.n === "0") {
		const beforeSeed = await get("/v1/streams/events?limit=1", STREAMS_KEY);
		check(
			"streams says the chain is empty (503, named)",
			beforeSeed.status === 503 &&
				field(beforeSeed.body, "code") === "CHAIN_DATA_UNAVAILABLE",
			beforeSeed,
		);
	} else {
		console.log("  – skipped (chain already has blocks)");
	}

	// ── seed a two-event block, plus enough follow-on blocks that the tip's
	// reorg-safety margin doesn't clamp the queried height out of range ──
	await sql`DELETE FROM decoded_events WHERE block_height >= ${HEIGHT}`.execute(
		db,
	);
	await sql`DELETE FROM events WHERE block_height >= ${HEIGHT}`.execute(db);
	await sql`DELETE FROM transactions WHERE block_height >= ${HEIGHT}`.execute(
		db,
	);
	await sql`DELETE FROM blocks WHERE height >= ${HEIGHT}`.execute(db);

	await db
		.insertInto("blocks")
		.values({
			height: HEIGHT,
			hash: "0xsmoke",
			parent_hash: "0xsmoke-parent",
			burn_block_height: 800_001,
			index_block_hash: "0xsmoke-ibh",
			timestamp: Math.floor(Date.now() / 1000),
			canonical: true,
		})
		.execute();
	// The API holds the servable tip a few blocks behind the real one so a
	// consumer never reads a height likely to reorg. Without these, the seeded
	// block sits above the clamp and every read is legitimately empty.
	for (let i = 1; i <= TIP_MARGIN_BLOCKS; i++) {
		await db
			.insertInto("blocks")
			.values({
				height: HEIGHT + i,
				hash: `0xsmoke-${i}`,
				parent_hash: i === 1 ? "0xsmoke" : `0xsmoke-${i - 1}`,
				burn_block_height: 800_001 + i,
				index_block_hash: `0xsmoke-ibh-${i}`,
				timestamp: Math.floor(Date.now() / 1000),
				canonical: true,
			})
			.execute();
	}

	await db
		.insertInto("transactions")
		.values({
			tx_id: "0xsmoketx",
			block_height: HEIGHT,
			tx_index: 0,
			type: "contract_call",
			sender: TREASURY,
			status: "success",
			contract_id: `${TOKEN}.token`,
			raw_tx: "0x00",
		})
		.execute();
	await db
		.insertInto("events")
		.values([
			{
				tx_id: "0xsmoketx",
				block_height: HEIGHT,
				event_index: 0,
				type: "ft_transfer_event",
				data: {
					asset_identifier: `${TOKEN}.token::smoke`,
					sender: TREASURY,
					recipient: HOLDER,
					amount: "100",
				},
			},
			{
				tx_id: "0xsmoketx",
				block_height: HEIGHT,
				event_index: 1,
				type: "stx_transfer_event",
				data: { sender: TREASURY, recipient: HOLDER, amount: "7" },
			},
		])
		.execute();
	await db
		.insertInto("decoded_events")
		.values({
			cursor: `${HEIGHT}:0`,
			block_height: HEIGHT,
			tx_id: "0xsmoketx",
			tx_index: 0,
			event_index: 0,
			event_type: "ft_transfer",
			contract_id: `${TOKEN}.token`,
			asset_identifier: `${TOKEN}.token::smoke`,
			sender: TREASURY,
			recipient: HOLDER,
			amount: "100",
			canonical: true,
			source_cursor: `${HEIGHT}:0`,
		})
		.execute();

	// ── 2. Labelled filter maps (S7.1) ─────────────────────────────────
	console.log("\nstreams: labelled filters");
	const filters = encodeURIComponent(
		JSON.stringify({
			peg: { types: ["ft_transfer"], assetIdentifier: `${TOKEN}.token::smoke` },
			treasury: { types: ["stx_transfer"], sender: TREASURY },
		}),
	);
	const labelled = await get(
		`/v1/streams/events?from_height=${HEIGHT}&to_height=${HEIGHT}&filters=${filters}`,
		STREAMS_KEY,
	);
	const events = (field(labelled.body, "events") ?? []) as Array<
		Record<string, unknown>
	>;
	check("two labels, one page", events.length === 2, labelled);
	check(
		"each event echoes its label",
		JSON.stringify(events.map((e) => e.matched)) ===
			JSON.stringify([["peg"], ["treasury"]]),
		events.map((e) => [e.event_type, e.matched]),
	);
	check(
		"one cursor covers both labels",
		typeof field(labelled.body, "next_cursor") === "string",
		field(labelled.body, "next_cursor"),
	);

	// ── 3. Index field selection (S7.2) ────────────────────────────────
	console.log("\nindex: field selection");
	const projected = await get(
		"/v1/index/events?event_type=ft_transfer&fields=recipient,amount&limit=5",
	);
	const row = (field(projected.body, "events.0") ?? undefined) as
		| Record<string, unknown>
		| undefined;
	check("row returned", !!row, projected);
	check(
		"unrequested column is absent, not null",
		!!row && !("asset_identifier" in row),
		row,
	);
	check(
		"cursor + discriminant always survive",
		!!row && "cursor" in row && "event_type" in row && "block_height" in row,
		row,
	);
	check(
		"block_time omitted with the join",
		!!row && !("block_time" in row),
		row,
	);

	// ── 4. Chain-read cache table is usable (S7.3) ─────────────────────
	console.log("\nsubgraphs: chain read cache");
	await sql`DELETE FROM chain_read_cache WHERE contract_id = ${`${TOKEN}.token`}`.execute(
		db,
	);
	await sql`
		INSERT INTO chain_read_cache
			(contract_id, function_name, args_hash, index_block_hash, block_height, result_hex)
		VALUES (${`${TOKEN}.token`}, 'get-decimals', 'h', '0xsmoke-ibh', ${HEIGHT}, '070100000000000000000000000000000006')
	`.execute(db);
	const dupe = await sql`
		INSERT INTO chain_read_cache
			(contract_id, function_name, args_hash, index_block_hash, block_height, result_hex)
		VALUES (${`${TOKEN}.token`}, 'get-decimals', 'h', '0xsmoke-ibh', ${HEIGHT}, 'other')
		ON CONFLICT DO NOTHING
		RETURNING id
	`.execute(db);
	check("pinned key is unique per block id", dupe.rows.length === 0);

	const constant = await sql`
		INSERT INTO chain_read_cache
			(contract_id, function_name, args_hash, index_block_hash, block_height, result_hex)
		VALUES (${`${TOKEN}.token`}, 'get-symbol', 'h', NULL, NULL, '0x00')
		ON CONFLICT DO NOTHING
		RETURNING id
	`.execute(db);
	check("contract-constant entries coexist", constant.rows.length === 1);

	// ── 5. Subgraph plane: bootstrap a key, deploy, read back ──────────
	// The whole point of self-hosting is deploying your own subgraph, and that
	// needs an owner key — there is no signup flow on a single-tenant box.
	console.log("\nsubgraphs: deploy");
	const key =
		process.env.INSTANCE_TOKEN ??
		process.env.API_KEY ??
		(await bootstrapKey(db));
	check("owner key provisioned", !!key);

	// Delete first so the smoke is repeatable: a prior run leaves the subgraph
	// mid-reindex, and a second deploy of the same name is a 409 by design.
	await fetch(`${API}/api/subgraphs/${SUBGRAPH}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${key}` },
	});

	const deployed = await post(
		"/api/subgraphs",
		{
			name: SUBGRAPH,
			schema: {
				transfers: {
					columns: {
						amount: { type: "uint" },
						recipient: { type: "principal" },
					},
				},
			},
			sources: { t: { type: "ft_transfer" } },
			startBlock: HEIGHT,
			handlerCode: HANDLER_CODE,
		},
		key,
	);
	check(
		"deploy accepted",
		(deployed.status === 200 || deployed.status === 201) &&
			["created", "updated"].includes(String(field(deployed.body, "action"))),
		deployed,
	);

	const list = await get("/v1/subgraphs");
	check(
		"subgraph list is served without a key",
		list.status === 200 &&
			((field(list.body, "subgraphs") ?? []) as Array<{ name?: string }>).some(
				(entry) => entry.name === SUBGRAPH,
			),
		list,
	);

	const rows = await get(`/v1/subgraphs/${SUBGRAPH}/transfers`);
	check(
		"deployed table is queryable over /v1",
		rows.status === 200 && Array.isArray(field(rows.body, "rows")),
		rows,
	);

	// ── 6. A sink consumer runs against the local Streams API ──────────
	// This is the "own your data" path: rows and the checkpoint land in the
	// operator's own Postgres, in one transaction, with no hosted dependency.
	console.log("\nsdk: sink consumer");
	await sql`DROP TABLE IF EXISTS smoke_sink_rows`.execute(db);
	await sql`DROP TABLE IF EXISTS smoke_sink_checkpoints`.execute(db);
	await sql`
		CREATE TABLE smoke_sink_rows (
			cursor text PRIMARY KEY,
			recipient text NOT NULL,
			height bigint NOT NULL
		)
	`.execute(db);

	const sl = createStreamsClient({ apiKey: STREAMS_KEY, baseUrl: API });
	// The sink is generic over the OPERATOR's schema, not ours — model the one
	// table this smoke writes so `ctx.tx` is typed like a real consumer's.
	const sinkDb = db as unknown as Kysely<SmokeSinkDb>;
	const sink = kyselySink(sinkDb, {
		id: "smoke",
		tables: ["smoke_sink_rows"],
		height: "height",
		checkpointTable: "smoke_sink_checkpoints",
	});

	await sl.events.consume({
		fromCursor: `${HEIGHT - 1}:0`,
		mode: "bounded",
		maxPages: 2,
		sink,
		types: ["ft_transfer"],
		onBatch: async (batchEvents, _envelope, ctx) => {
			for (const event of batchEvents) {
				await ctx.tx
					.insertInto("smoke_sink_rows")
					.values({
						cursor: event.cursor,
						recipient: (event.payload as { recipient: string }).recipient,
						height: event.block_height,
					})
					.execute();
			}
		},
	});

	const sunk = await sql<{ n: string }>`
		SELECT count(*)::text AS n FROM smoke_sink_rows
	`.execute(db);
	check(
		"sink wrote rows to the local database",
		sunk.rows[0]?.n === "1",
		sunk.rows,
	);

	const checkpoint = await sql<{ cursor: string }>`
		SELECT cursor FROM smoke_sink_checkpoints WHERE id = 'smoke'
	`.execute(db);
	check(
		"sink committed a checkpoint alongside them",
		!!checkpoint.rows[0]?.cursor,
		checkpoint.rows,
	);

	await db.destroy();

	console.log(
		failures === 0
			? "\nself-host smoke: all checks passed\n"
			: `\nself-host smoke: ${failures} check(s) FAILED\n`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error("\nself-host smoke: crashed\n", err);
	process.exit(1);
});
