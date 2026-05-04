import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0065 } from "../migrations/0065_l2_decoded_events.ts";
import {
	down as down0066,
	up as up0066,
} from "../migrations/0066_public_l2_decoded_events.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("0066_public_l2_decoded_events migration", () => {
	test("reshapes decoded_events for the public L2 schema", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");

		const schema = `migration_0066_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);

			await up0065(db);
			await sql`
				INSERT INTO decoded_events (
					cursor,
					block_height,
					tx_id,
					tx_index,
					event_index,
					event_type,
					decoded_payload,
					source_cursor
				) VALUES (
					'1:0',
					1,
					'0xtx',
					0,
					0,
					'ft_transfer',
					'{"contract_id":"SP1.token","sender":"SP1","recipient":"SP2","amount":"10","asset_identifier":"SP1.token::sbtc"}'::jsonb,
					'1:0'
				)
			`.execute(db);

			await up0066(db);

			const columns = await sql<{ column_name: string }>`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = ${schema}
					AND table_name = 'decoded_events'
				ORDER BY ordinal_position
			`.execute(db);
			const indexes = await sql<{ indexname: string }>`
				SELECT indexname
				FROM pg_indexes
				WHERE schemaname = ${schema}
				ORDER BY indexname
			`.execute(db);
			const row = await db
				.selectFrom("decoded_events")
				.select([
					"contract_id",
					"sender",
					"recipient",
					"amount",
					"asset_identifier",
					"canonical",
				])
				.executeTakeFirstOrThrow();

			expect(columns.rows.map((col) => col.column_name)).not.toContain(
				"decoded_payload",
			);
			expect(columns.rows.map((col) => col.column_name)).toEqual(
				expect.arrayContaining([
					"cursor",
					"event_type",
					"microblock_hash",
					"canonical",
					"contract_id",
					"sender",
					"recipient",
					"amount",
					"asset_identifier",
					"value",
					"memo",
				]),
			);
			expect(indexes.rows.map((idx) => idx.indexname)).toEqual(
				expect.arrayContaining([
					"decoded_events_contract_height_event_idx",
					"decoded_events_sender_height_event_idx",
					"decoded_events_recipient_height_event_idx",
				]),
			);
			expect(row).toEqual({
				contract_id: "SP1.token",
				sender: "SP1",
				recipient: "SP2",
				amount: "10",
				asset_identifier: "SP1.token::sbtc",
				canonical: true,
			});

			await down0066(db);

			const afterDown = await sql<{ column_name: string }>`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = ${schema}
					AND table_name = 'decoded_events'
			`.execute(db);
			expect(afterDown.rows.map((col) => col.column_name)).toContain(
				"decoded_payload",
			);
			expect(afterDown.rows.map((col) => col.column_name)).not.toContain(
				"contract_id",
			);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
			await client.end();
		}
	});
});
