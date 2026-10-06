import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
	listPollableTenants,
	listProvisioningTenants,
	listRunningTenants,
	listTenants,
	setTenantImageSha,
	setTenantState,
} from "./control-db.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

describe("acct8For", () => {
	test("first 8 lowercase alphanumeric characters", () => {
		expect(acct8For("ABCDEFGH-1234-0000")).toBe("abcdefgh");
	});

	test("strips hyphens before taking the first 8", () => {
		expect(acct8For("ab-cd-ef-gh-ij")).toBe("abcdefgh");
	});

	test("is stable for the same input", () => {
		const id = "f00dcafe-aaaa-bbbb-cccc-000000000000";
		expect(acct8For(id)).toBe(acct8For(id));
	});
});

describe.skipIf(!HAS_DB)("control-db", () => {
	beforeAll(async () => {
		await ensureControlSchema(db);
	});

	afterAll(async () => {
		await db.end();
	});

	test("insertProvisioningTenant is idempotent under a concurrent race", async () => {
		const accountId = crypto.randomUUID();
		const acct8 = acct8For(accountId);
		const [first, second] = await Promise.all([
			insertProvisioningTenant(db, accountId, acct8),
			insertProvisioningTenant(db, accountId, acct8),
		]);
		// Exactly one of the two racing inserts wins.
		expect([first.inserted, second.inserted].filter(Boolean)).toHaveLength(1);
		// Both callers agree on the same allocated port — nobody double-allocates.
		expect(first.apiPort).toBe(second.apiPort);

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("provisioning");
		expect(row?.api_port).toBe(first.apiPort);

		await deleteTenant(db, accountId);
	});

	test("insertProvisioningTenant survives 20 concurrent inserts for one account", async () => {
		const accountId = crypto.randomUUID();
		const acct8 = acct8For(accountId);
		try {
			const results = await Promise.all(
				Array.from({ length: 20 }, () =>
					insertProvisioningTenant(db, accountId, acct8),
				),
			);
			expect(results.filter((r) => r.inserted)).toHaveLength(1);
			expect(new Set(results.map((r) => r.apiPort)).size).toBe(1);
			expect(new Set(results.map((r) => r.subnetIdx)).size).toBe(1);
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("insertProvisioningTenant throws when another account owns the acct8", async () => {
		const prefix = crypto.randomUUID().slice(0, 8);
		const a = `${prefix}-0000-0000-0000-000000000000`;
		const b = `${prefix}-1111-1111-1111-111111111111`;
		expect(acct8For(a)).toBe(acct8For(b));
		try {
			await insertProvisioningTenant(db, a, acct8For(a));
			await expect(
				insertProvisioningTenant(db, b, acct8For(b)),
			).rejects.toThrow(/acct8 collision/);
		} finally {
			await deleteTenant(db, a);
			await deleteTenant(db, b);
		}
	});

	test("two different accounts never get the same api_port", async () => {
		const a = crypto.randomUUID();
		const b = crypto.randomUUID();
		const resultA = await insertProvisioningTenant(db, a, acct8For(a));
		const resultB = await insertProvisioningTenant(db, b, acct8For(b));
		expect(resultA.apiPort).not.toBe(resultB.apiPort);
		await deleteTenant(db, a);
		await deleteTenant(db, b);
	});

	test("subnet_idx is allocated once per account, shared by racing inserts, and never repeated across accounts", async () => {
		const a = crypto.randomUUID();
		const b = crypto.randomUUID();
		const [first, second] = await Promise.all([
			insertProvisioningTenant(db, a, acct8For(a)),
			insertProvisioningTenant(db, a, acct8For(a)),
		]);
		expect(first.subnetIdx).toBe(second.subnetIdx);
		const other = await insertProvisioningTenant(db, b, acct8For(b));
		expect(other.subnetIdx).not.toBe(first.subnetIdx);
		expect((await getTenant(db, a))?.subnet_idx).toBe(first.subnetIdx);

		// Never reused: a destroyed tenant's index isn't handed to the next one.
		await deleteTenant(db, a);
		const c = crypto.randomUUID();
		const next = await insertProvisioningTenant(db, c, acct8For(c));
		expect(next.subnetIdx).toBeGreaterThan(other.subnetIdx);
		await deleteTenant(db, b);
		await deleteTenant(db, c);
	});

	test("setTenantState('stopped') stamps stopped_at; leaving it clears it", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await setTenantState(db, accountId, "running");

		let row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");
		expect(row?.stopped_at).toBeNull();

		await setTenantState(db, accountId, "stopped");
		row = await getTenant(db, accountId);
		expect(row?.state).toBe("stopped");
		expect(row?.stopped_at).not.toBeNull();

		await setTenantState(db, accountId, "running");
		row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");
		expect(row?.stopped_at).toBeNull();

		await deleteTenant(db, accountId);
	});

	test("deleteTenant removes the row; getTenant returns undefined after", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await deleteTenant(db, accountId);
		expect(await getTenant(db, accountId)).toBeUndefined();
	});

	test("listTenants includes every inserted row", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		const rows = await listTenants(db);
		expect(rows.some((r) => r.account_id === accountId)).toBe(true);
		await deleteTenant(db, accountId);
	});

	test("listPollableTenants includes running/stopped, excludes provisioning", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		let pollable = await listPollableTenants(db);
		expect(pollable.some((r) => r.account_id === accountId)).toBe(false);

		await setTenantState(db, accountId, "running");
		pollable = await listPollableTenants(db);
		expect(pollable.some((r) => r.account_id === accountId)).toBe(true);

		await setTenantState(db, accountId, "stopped");
		pollable = await listPollableTenants(db);
		expect(pollable.some((r) => r.account_id === accountId)).toBe(true);

		await deleteTenant(db, accountId);
	});

	test("ensureControlSchema adds image_sha to a table created before the column existed", async () => {
		await db`ALTER TABLE tenants DROP COLUMN IF EXISTS image_sha`;
		await ensureControlSchema(db);
		const cols = await db`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = 'tenants' AND column_name = 'image_sha'
		`;
		expect(cols).toHaveLength(1);
	});

	test("ensureControlSchema adds template_sha to a table created before the column existed", async () => {
		await db`ALTER TABLE tenants DROP COLUMN IF EXISTS template_sha`;
		await ensureControlSchema(db);
		const cols = await db`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = 'tenants' AND column_name = 'template_sha'
		`;
		expect(cols).toHaveLength(1);
	});

	test("a freshly inserted row has a null image_sha until setTenantImageSha records one", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		let row = await getTenant(db, accountId);
		expect(row?.image_sha).toBeNull();

		const sha = "a".repeat(40);
		await setTenantImageSha(db, accountId, sha);
		row = await getTenant(db, accountId);
		expect(row?.image_sha).toBe(sha);

		await deleteTenant(db, accountId);
	});

	test("listProvisioningTenants returns only provisioning rows", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		expect(
			(await listProvisioningTenants(db)).some(
				(r) => r.account_id === accountId,
			),
		).toBe(true);

		await setTenantState(db, accountId, "running");
		expect(
			(await listProvisioningTenants(db)).some(
				(r) => r.account_id === accountId,
			),
		).toBe(false);

		await deleteTenant(db, accountId);
	});

	test("listRunningTenants excludes stopped and provisioning", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		expect(
			(await listRunningTenants(db)).some((r) => r.account_id === accountId),
		).toBe(false);

		await setTenantState(db, accountId, "running");
		expect(
			(await listRunningTenants(db)).some((r) => r.account_id === accountId),
		).toBe(true);

		await setTenantState(db, accountId, "stopped");
		expect(
			(await listRunningTenants(db)).some((r) => r.account_id === accountId),
		).toBe(false);

		await deleteTenant(db, accountId);
	});
});
