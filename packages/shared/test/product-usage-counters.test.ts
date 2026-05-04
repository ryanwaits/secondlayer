import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	down as down0067,
	up as up0067,
} from "../migrations/0067_product_usage_counters.ts";
import type { Database } from "../src/db/types.ts";
import {
	incrementIndexDecodedEventsReturned,
	incrementStreamsEventsReturned,
} from "../src/db/queries/usage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("0067_product_usage_counters migration", () => {
	test("adds product counters and usage helpers increment them", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");

		const schema = `migration_0067_${Date.now().toString(36)}`;
		const accountId = "00000000-0000-4000-8000-000000000067";
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);
			await sql`
				CREATE TABLE accounts (
					id uuid PRIMARY KEY,
					email text NOT NULL,
					plan text NOT NULL DEFAULT 'build',
					created_at timestamptz NOT NULL DEFAULT NOW()
				)
			`.execute(db);
			await sql`
				CREATE TABLE usage_daily (
					account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
					tenant_id uuid,
					date date NOT NULL,
					api_requests integer NOT NULL DEFAULT 0,
					deliveries integer NOT NULL DEFAULT 0
				)
			`.execute(db);
			await sql`
				CREATE UNIQUE INDEX usage_daily_account_null_tenant_key
					ON usage_daily (account_id, date)
					WHERE tenant_id IS NULL
			`.execute(db);
			await sql`
				INSERT INTO accounts (id, email, plan)
				VALUES (${accountId}, 'metering@example.com', 'build')
			`.execute(db);

			await up0067(db);
			await incrementStreamsEventsReturned(db, accountId, 3);
			await incrementIndexDecodedEventsReturned(db, accountId, 5);
			await incrementStreamsEventsReturned(db, accountId, 2);

			const row = await db
				.selectFrom("usage_daily")
				.select([
					"streams_events_returned",
					"index_decoded_events_returned",
					"api_requests",
					"deliveries",
				])
				.where("account_id", "=", accountId)
				.executeTakeFirstOrThrow();

			expect(row).toEqual({
				streams_events_returned: 5,
				index_decoded_events_returned: 5,
				api_requests: 0,
				deliveries: 0,
			});

			await down0067(db);
			const columns = await sql<{ column_name: string }>`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = ${schema}
					AND table_name = 'usage_daily'
			`.execute(db);
			expect(columns.rows.map((column) => column.column_name)).not.toContain(
				"streams_events_returned",
			);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
			await client.end();
		}
	});
});
