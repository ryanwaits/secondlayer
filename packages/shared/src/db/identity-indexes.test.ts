import { describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";

// Migrations sit outside this package's tsconfig rootDir, so load by path.
const TENANT_INDEX_MIGRATION =
	"../../migrations/0186_api_keys_one_active_tenant_per_name.ts";
async function addTenantIndex(db: Kysely<unknown>): Promise<void> {
	const migration = (await import(TENANT_INDEX_MIGRATION)) as {
		up(db: Kysely<unknown>): Promise<void>;
	};
	await migration.up(db);
}
import { getDb } from "./index.ts";

const SKIP = !process.env.DATABASE_URL;

type Trx = ReturnType<typeof getDb>;

/** Run `statement` in a transaction that always rolls back; return the error text. */
async function rejection(
	statement: (trx: Trx) => Promise<unknown>,
): Promise<string | null> {
	let message: string | null = null;
	await getDb()
		.transaction()
		.execute(async (trx) => {
			try {
				await statement(trx as unknown as Trx);
			} catch (error) {
				message = String(error instanceof Error ? error.message : error);
			}
			throw new Error("rollback");
		})
		.catch(() => {});
	return message;
}

async function account(trx: Trx, email: string | null): Promise<string> {
	const { rows } = await sql<{ id: string }>`
		INSERT INTO accounts (email) VALUES (${email}) RETURNING id
	`.execute(trx);
	return rows[0]?.id as string;
}

async function tenantKey(
	trx: Trx,
	accountId: string,
	name: string,
	status: "active" | "revoked",
) {
	const hash = crypto.randomUUID();
	await sql`
		INSERT INTO api_keys
			(key_hash, key_prefix, name, ip_address, account_id, product, status, revoked_at)
		VALUES
			(${hash}, 'sk-sl_test', ${name}, 'workload-host', ${accountId}, 'tenant', ${status},
			 ${status === "revoked" ? sql`now()` : null})
	`.execute(trx);
}

describe.skipIf(SKIP)("one active tenant key per account and name", () => {
	test("a second active tenant key with the same name is refused", async () => {
		const error = await rejection(async (trx) => {
			const id = await account(trx, `tenant-dup-${crypto.randomUUID()}@x.test`);
			await tenantKey(trx, id, "hosted-stack", "active");
			await tenantKey(trx, id, "hosted-stack", "active");
		});
		expect(error).toContain("api_keys_one_active_tenant_per_name");
	});

	test("a revoked key and its active successor share a name", async () => {
		const error = await rejection(async (trx) => {
			const id = await account(trx, `tenant-rot-${crypto.randomUUID()}@x.test`);
			await tenantKey(trx, id, "hosted-stack", "revoked");
			await tenantKey(trx, id, "hosted-stack", "active");
		});
		expect(error).toBeNull();
	});

	test("the migration revokes older duplicate active keys and keeps the newest", async () => {
		let kept: string[] = [];
		const error = await rejection(async (trx) => {
			// Rebuild the state of a database from before the index existed.
			await sql`DROP INDEX api_keys_one_active_tenant_per_name`.execute(trx);
			const id = await account(trx, `tenant-mig-${crypto.randomUUID()}@x.test`);
			await tenantKey(trx, id, "hosted-stack", "active");
			await tenantKey(trx, id, "hosted-stack", "active");
			await tenantKey(trx, id, "hosted-stack", "active");
			await addTenantIndex(trx as unknown as Kysely<unknown>);
			const { rows } = await sql<{ status: string }>`
				SELECT status FROM api_keys WHERE account_id = ${id} ORDER BY created_at, id
			`.execute(trx);
			kept = rows.map((r) => r.status);
			await tenantKey(trx, id, "hosted-stack", "active");
		});
		expect(kept.filter((s) => s === "active")).toHaveLength(1);
		expect(kept.filter((s) => s === "revoked")).toHaveLength(2);
		// A fourth active key is refused again once the index is back.
		expect(error).toContain("api_keys_one_active_tenant_per_name");
	});

	test("different names and different accounts do not collide", async () => {
		const error = await rejection(async (trx) => {
			const a = await account(trx, `tenant-a-${crypto.randomUUID()}@x.test`);
			const b = await account(trx, `tenant-b-${crypto.randomUUID()}@x.test`);
			await tenantKey(trx, a, "hosted-stack", "active");
			await tenantKey(trx, a, "other", "active");
			await tenantKey(trx, b, "hosted-stack", "active");
		});
		expect(error).toBeNull();
	});
});

describe.skipIf(SKIP)("one account per email address", () => {
	test("an address differing only in case is refused", async () => {
		const error = await rejection(async (trx) => {
			const email = `Case-${crypto.randomUUID()}@x.test`;
			await account(trx, email);
			await account(trx, email.toLowerCase());
		});
		expect(error).toContain("accounts_email_lower_idx");
	});

	test("ghost accounts without an email coexist", async () => {
		const error = await rejection(async (trx) => {
			await account(trx, null);
			await account(trx, null);
		});
		expect(error).toBeNull();
	});
});
