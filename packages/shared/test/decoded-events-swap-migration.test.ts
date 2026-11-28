import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as swapDecodedEvents } from "../migrations/0227_decoded_events_swap.ts";
import {
	LIVE_REWRITE_SPECS,
	copyToTip,
	createBookkeeping,
	ensureProgressRow,
	installTriggers,
	planClone,
} from "../src/db/live-rewrite.ts";
import { printPayloadFromStored } from "../src/streams-rows/index.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const TUPLE_HEX = `0x0c00000001016101${"00".repeat(15)}01`;

async function withAdmin<T>(
	fn: (admin: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
	const admin = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
	try {
		return await fn(admin);
	} finally {
		await admin.end();
	}
}

async function createScratchDatabase(): Promise<string> {
	const name = `decoded_swap_${Date.now().toString(36)}_${process.pid}`;
	await withAdmin((admin) => admin.unsafe(`CREATE DATABASE ${name}`));
	const url = new URL(process.env.DATABASE_URL ?? "");
	url.pathname = `/${name}`;
	return url.toString();
}

async function dropScratchDatabase(url: string): Promise<void> {
	const name = new URL(url).pathname.slice(1);
	await withAdmin((admin) =>
		admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
	);
}

function legacyPrint(): string {
	return JSON.stringify(
		printPayloadFromStored({
			payload: null,
			raw_value: Buffer.from(TUPLE_HEX.slice(2), "hex"),
		}),
	);
}

async function createLive(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE decoded_events (
			cursor TEXT NOT NULL,
			block_height BIGINT NOT NULL,
			tx_id TEXT NOT NULL,
			tx_index INTEGER NOT NULL,
			event_index INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT now(),
			canonical BOOLEAN NOT NULL DEFAULT true,
			contract_id TEXT,
			sender TEXT,
			recipient TEXT,
			amount TEXT,
			asset_identifier TEXT,
			value TEXT,
			memo TEXT,
			payload JSONB,
			raw_value BYTEA,
			CONSTRAINT decoded_events_pkey PRIMARY KEY (cursor)
		)
	`.execute(db);
	await sql`CREATE INDEX decoded_events_block_height_idx ON decoded_events (block_height)`.execute(
		db,
	);
}

async function insertLegacy(
	db: Kysely<unknown>,
	cursor: string,
	type: string,
	payload: string,
): Promise<void> {
	await sql`
		INSERT INTO decoded_events
			(cursor, block_height, tx_id, tx_index, event_index, event_type, payload)
		VALUES (${cursor}, ${Number(cursor.split(":")[0])}, ${`tx-${cursor}`}, 0, 0, ${type},
			to_jsonb(${payload}::text))
	`.execute(db);
}

async function layout(db: Kysely<unknown>) {
	const { rows } = await sql<{
		cursor: string;
		kind: string | null;
		hex: string | null;
	}>`
		SELECT cursor, jsonb_typeof(payload) AS kind, encode(raw_value, 'hex') AS hex
		  FROM decoded_events ORDER BY cursor
	`.execute(db);
	return rows;
}

describe.skipIf(!HAS_DB)("decoded_events swap migration", () => {
	let url = "";
	let client: ReturnType<typeof postgres>;
	let db: Kysely<unknown>;

	beforeAll(async () => {
		url = await createScratchDatabase();
		client = postgres(url, { max: 4, onnotice: () => {} });
		db = new Kysely<unknown>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
	});

	afterAll(async () => {
		await db.destroy();
		await dropScratchDatabase(url);
	});

	test("a small table without a next table is rewritten in place", async () => {
		await createLive(db);
		await insertLegacy(db, "10:0", "print", legacyPrint());
		await insertLegacy(
			db,
			"12:0",
			"stx_lock",
			JSON.stringify({ unlock_height: "99" }),
		);
		await insertLegacy(
			db,
			"13:0",
			"print",
			JSON.stringify({ topic: "print", value: "x", raw_value: null }),
		);

		await swapDecodedEvents(db);

		expect(await layout(db)).toEqual([
			{ cursor: "10:0", kind: null, hex: TUPLE_HEX.slice(2) },
			{ cursor: "12:0", kind: "object", hex: null },
			{ cursor: "13:0", kind: "object", hex: null },
		]);
	});

	test("a verified decoded_events_next replaces the live table and keeps the old one", async () => {
		await sql`DROP TABLE decoded_events`.execute(db);
		await createLive(db);
		await insertLegacy(db, "10:0", "print", legacyPrint());
		await insertLegacy(
			db,
			"12:0",
			"stx_lock",
			JSON.stringify({ unlock_height: "99" }),
		);
		const spec = LIVE_REWRITE_SPECS.decoded_events;
		if (!spec) throw new Error("decoded_events spec missing");
		await createBookkeeping(db);
		await spec.createNext.execute(db);
		await ensureProgressRow(db, "decoded_events");
		await installTriggers(db, spec);
		await copyToTip(db, spec, { stampCopiedAt: true });
		const plan = await planClone(db, spec);
		for (const index of plan.indexes) {
			await sql.raw(index.create).execute(db);
		}
		await sql`
			UPDATE live_rewrite_progress SET verified_at = now() + interval '1 second'
			 WHERE table_name = 'decoded_events'
		`.execute(db);
		await insertLegacy(db, "14:0", "print", legacyPrint());

		await swapDecodedEvents(db);

		expect(await layout(db)).toEqual([
			{ cursor: "10:0", kind: null, hex: TUPLE_HEX.slice(2) },
			{ cursor: "12:0", kind: "object", hex: null },
			{ cursor: "14:0", kind: null, hex: TUPLE_HEX.slice(2) },
		]);
		const old = await sql<{ n: number }>`
			SELECT count(*)::int AS n FROM decoded_events_old
		`.execute(db);
		expect(old.rows[0]?.n).toBe(3);
	});

	test("a large table without a next table refuses to migrate", async () => {
		await sql`UPDATE pg_class SET reltuples = 5000000 WHERE oid = 'decoded_events'::regclass`.execute(
			db,
		);
		await sql`DROP TABLE IF EXISTS decoded_events_next`.execute(db);
		await expect(swapDecodedEvents(db)).rejects.toThrow(/live-rewrite\.ts/);
	});
});
