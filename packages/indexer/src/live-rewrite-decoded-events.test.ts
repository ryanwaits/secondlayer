import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	LIVE_REWRITE_SPECS,
	diffDigests,
} from "@secondlayer/shared/db/live-rewrite";
import { printPayloadFromStored } from "@secondlayer/shared/streams-rows";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { runLiveRewrite } from "./live-rewrite.ts";
import {
	countDiverging,
	goldenLines,
	parseGoldenFile,
} from "./print-payload-golden.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const TUPLE_HEX = `0x0c00000001016101${"00".repeat(15)}01`;
const UINT_HEX = `0x01${"00".repeat(15)}2a`;

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
	const name = `decoded_rewrite_${Date.now().toString(36)}_${process.pid}`;
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

function legacyPrint(hex: string): string {
	return JSON.stringify(
		printPayloadFromStored({
			payload: null,
			raw_value: Buffer.from(hex.slice(2), "hex"),
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
	await sql`CREATE INDEX decoded_events_type_height_event_idx ON decoded_events (event_type, block_height, event_index) WHERE canonical`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_contract_height_event_idx ON decoded_events (contract_id, block_height, event_index) WHERE contract_id IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_sender_height_event_idx ON decoded_events (sender, block_height, event_index) WHERE sender IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX decoded_events_recipient_height_event_idx ON decoded_events (recipient, block_height, event_index) WHERE recipient IS NOT NULL`.execute(
		db,
	);
}

async function insert(
	db: Kysely<unknown>,
	cursor: string,
	type: string,
	columns: {
		payload?: string | null;
		raw?: string | null;
		sender?: string;
	},
): Promise<void> {
	const height = Number(cursor.split(":")[0]);
	const raw = columns.raw ? Buffer.from(columns.raw.slice(2), "hex") : null;
	await sql`
		INSERT INTO decoded_events
			(cursor, block_height, tx_id, tx_index, event_index, event_type,
			 contract_id, sender, payload, raw_value)
		VALUES (${cursor}, ${height}, ${`tx-${cursor}`}, 0, 0, ${type},
			'SP1.c', ${columns.sender ?? null},
			${columns.payload === undefined || columns.payload === null ? null : sql`to_jsonb(${columns.payload}::text)`},
			${raw})
	`.execute(db);
}

describe.skipIf(!HAS_DB)("decoded_events live rewrite spec", () => {
	let url = "";
	let client: ReturnType<typeof postgres>;
	let db: Kysely<unknown>;
	const lines: string[] = [];
	const options = {
		apply: true,
		sample: 50,
		print: (line: string) => lines.push(line),
	};

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

	test("a rewrite carries legacy, bytes and fallback rows to the new layout with equal digests and golden hashes", async () => {
		const spec = LIVE_REWRITE_SPECS.decoded_events;
		if (!spec) throw new Error("decoded_events spec missing");
		await createLive(db);
		await insert(db, "10:0", "print", { payload: legacyPrint(TUPLE_HEX) });
		await insert(db, "10:1", "print", { payload: legacyPrint(UINT_HEX) });
		await insert(db, "11:0", "print", { raw: TUPLE_HEX });
		await insert(db, "12:0", "stx_lock", {
			payload: JSON.stringify({ unlock_height: 99 }),
			sender: "SP1",
		});
		await insert(db, "12:1", "ft_transfer", { sender: "SP1" });
		await insert(db, "13:0", "print", {
			payload: JSON.stringify({
				topic: "print",
				value: "plain",
				raw_value: null,
			}),
		});

		const heights = [10, 11, 12, 13];
		const before: string[] = [];
		for await (const line of goldenLines(db, "decoded_events", heights)) {
			before.push(line);
		}
		expect(before).toHaveLength(4);

		expect(await runLiveRewrite(db, spec, "prepare", options)).toBe(0);
		expect(await runLiveRewrite(db, spec, "copy", options)).toBe(0);
		expect(await runLiveRewrite(db, spec, "index", options)).toBe(0);
		expect(await runLiveRewrite(db, spec, "verify", options)).toBe(0);

		const live = (await spec.digestLive(heights).execute(db)).rows;
		const next = (await spec.digestNext(heights).execute(db)).rows;
		expect(diffDigests(live as never, next as never)).toEqual([]);

		const { rows } = await sql<{
			cursor: string;
			payload_kind: string | null;
			raw_hex: string | null;
		}>`
			SELECT cursor, jsonb_typeof(payload) AS payload_kind, encode(raw_value, 'hex') AS raw_hex
			  FROM decoded_events_next ORDER BY cursor
		`.execute(db);
		expect(rows).toEqual([
			{ cursor: "10:0", payload_kind: null, raw_hex: TUPLE_HEX.slice(2) },
			{ cursor: "10:1", payload_kind: null, raw_hex: UINT_HEX.slice(2) },
			{ cursor: "11:0", payload_kind: null, raw_hex: TUPLE_HEX.slice(2) },
			{ cursor: "12:0", payload_kind: "object", raw_hex: null },
			{ cursor: "12:1", payload_kind: null, raw_hex: null },
			{ cursor: "13:0", payload_kind: "object", raw_hex: null },
		]);

		const expected = parseGoldenFile(`${before.join("\n")}\n`);
		const diverging = await countDiverging(
			goldenLines(db, "decoded_events_next", heights),
			expected,
		);
		expect(diverging).toBe(0);
	});

	test("the golden fingerprint of one range is stable across two reads", async () => {
		const first: string[] = [];
		const second: string[] = [];
		for await (const line of goldenLines(db, "decoded_events", [10, 11, 13])) {
			first.push(line);
		}
		for await (const line of goldenLines(db, "decoded_events", [10, 11, 13])) {
			second.push(line);
		}
		expect(second).toEqual(first);
		expect(
			await countDiverging(
				goldenLines(db, "decoded_events", [10, 11, 13]),
				parseGoldenFile(`${first.join("\n")}\n`),
			),
		).toBe(0);
	});

	test("the golden compare flags a row whose served payload changed", async () => {
		const expected = parseGoldenFile(
			`10:0\t${"0".repeat(64)}\n99:0\t${"1".repeat(64)}\n`,
		);
		expect(
			await countDiverging(goldenLines(db, "decoded_events", [10]), expected),
		).toBe(3);
	});
});
