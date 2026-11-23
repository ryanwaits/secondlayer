// Round 1 fix (plan 062): an *existing* oss install pulling the `bitcoin`
// compose profile update gets `BITCOIN_DATABASE_URL` pointed at a `bitcoin`
// database that was never created — the postgres init script that creates it
// (`docker/oss/postgres-init/`) only runs on a brand-new volume. `migrate`
// must self-provision that database instead of failing forever.
//
// Skipped when BITCOIN_TEST_DATABASE_URL isn't set (same convention as
// rewind.test.ts/follow.test.ts) — used here only to discover the dev
// Postgres server (host/port/admin credentials), not as the database under
// test: both tests below target their own database name derived from it,
// which they create/drop themselves rather than requiring the caller to
// pre-create one.
//
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_migrate_test \
//     bun test src/db/migrate.test.ts
import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
	createDatabaseIfMissing,
	databaseNameFromUrl,
	migrateToLatest,
} from "./migrate.ts";
import { openStore } from "./store.ts";

describe("databaseNameFromUrl", () => {
	test("extracts the path segment as the database name", () => {
		expect(databaseNameFromUrl("postgres://user:pass@host:5432/bitcoin")).toBe(
			"bitcoin",
		);
	});

	test("throws when the URL has no database name", () => {
		expect(() =>
			databaseNameFromUrl("postgres://user:pass@host:5432/"),
		).toThrow(/no database name/);
	});
});

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;

describe.skipIf(!testUrl)("migrateToLatest self-provisioning", () => {
	// `describe.skipIf` still evaluates this callback body to register its
	// tests even when the condition is true — the fallback keeps `new URL`
	// from throwing in that case (the `test()` bodies themselves never run).
	const serverUrl = new URL(testUrl ?? "postgres://x/x");
	const adminUrl = new URL(serverUrl);
	adminUrl.pathname = "/postgres";
	const admin = postgres(adminUrl.toString(), { max: 1 });

	afterAll(async () => {
		await admin.end();
	});

	test("creates the database itself when it doesn't exist yet, then migrates it", async () => {
		const dbName = "bitcoin_migrate062_selfprovision_test";
		const dbUrl = new URL(serverUrl);
		dbUrl.pathname = `/${dbName}`;

		// Deliberately NOT pre-created — that's the whole point of this test.
		// Idempotent guard for a re-run of this suite: drop it first if a prior
		// run left it behind (e.g. a crash between create and this test's own
		// cleanup).
		await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);

		const prevUrl = process.env.BITCOIN_DATABASE_URL;
		process.env.BITCOIN_DATABASE_URL = dbUrl.toString();
		try {
			await migrateToLatest();
		} finally {
			if (prevUrl === undefined) delete process.env.BITCOIN_DATABASE_URL;
			else process.env.BITCOIN_DATABASE_URL = prevUrl;
		}

		// The migration actually ran (not just "didn't throw"): the table
		// migration 0001 creates is queryable.
		const db = openStore(dbUrl.toString());
		const row = await db
			.selectFrom("runes_checkpoint")
			.select("name")
			.executeTakeFirst();
		expect(row).toBeUndefined(); // table exists and is empty — no throw either way
		await db.destroy();

		await admin.unsafe(`DROP DATABASE "${dbName}"`);
	});

	test("runes keyset indexes replace the address-only balances index", async () => {
		const dbName = "bitcoin_migrate_runes_sort_indexes_test";
		const dbUrl = new URL(serverUrl);
		dbUrl.pathname = `/${dbName}`;
		await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);

		const prevUrl = process.env.BITCOIN_DATABASE_URL;
		process.env.BITCOIN_DATABASE_URL = dbUrl.toString();
		try {
			await migrateToLatest();
		} finally {
			if (prevUrl === undefined) delete process.env.BITCOIN_DATABASE_URL;
			else process.env.BITCOIN_DATABASE_URL = prevUrl;
		}

		const client = postgres(dbUrl.toString(), { max: 1 });
		try {
			const rows = await client<{ indexname: string; indexdef: string }[]>`
				SELECT indexname, indexdef FROM pg_indexes
				WHERE tablename IN ('rune_entries', 'rune_balances')
			`;
			const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
			expect(defs.get("rune_entries_mints_number_idx")).toContain(
				"(mints DESC, number DESC)",
			);
			expect(defs.get("rune_balances_address_keyset_idx")).toContain(
				"(address, rune_id, txid, vout)",
			);
			expect(defs.has("rune_balances_address_idx")).toBe(false);

			await client`SET enable_seqscan = off`;
			const mintsPlan = await client.unsafe(
				"EXPLAIN SELECT * FROM rune_entries WHERE (mints, number) < (10, 10) ORDER BY mints DESC, number DESC LIMIT 5",
			);
			expect(JSON.stringify(mintsPlan)).toContain(
				"rune_entries_mints_number_idx",
			);
			const balancesPlan = await client.unsafe(
				"EXPLAIN SELECT * FROM rune_balances WHERE address = 'bc1q' AND (rune_id, txid, vout) > ('1:0', 'aa', 0) ORDER BY rune_id, txid, vout LIMIT 5",
			);
			expect(JSON.stringify(balancesPlan)).toContain(
				"rune_balances_address_keyset_idx",
			);
		} finally {
			await client.end();
			await admin.unsafe(`DROP DATABASE "${dbName}"`);
		}
	});

	test("a role without CREATEDB gets a clear, actionable error instead of a bare Postgres error", async () => {
		const roleName = "bitcoin_migrate062_nocreatedb_test";
		const dbName = "bitcoin_migrate062_norole_test"; // never created — the role can't create it either

		await admin.unsafe(`DROP ROLE IF EXISTS "${roleName}"`);
		await admin.unsafe(
			`CREATE ROLE "${roleName}" LOGIN PASSWORD 'test' NOCREATEDB`,
		);

		try {
			const restrictedUrl = new URL(serverUrl);
			restrictedUrl.username = roleName;
			restrictedUrl.password = "test";
			restrictedUrl.pathname = `/${dbName}`;

			await expect(
				createDatabaseIfMissing(restrictedUrl.toString()),
			).rejects.toThrow(/can't create it.*CREATEDB/s);
		} finally {
			await admin.unsafe(`DROP ROLE "${roleName}"`);
		}
	});
});
