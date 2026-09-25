import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
	listTenants,
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
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);
		const [first, second] = await Promise.all([
			insertProvisioningTenant(db, accountId, acct8),
			insertProvisioningTenant(db, accountId, acct8),
		]);
		// Exactly one of the two racing inserts wins.
		expect([first.inserted, second.inserted].filter(Boolean)).toHaveLength(1);

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("provisioning");

		await deleteTenant(db, accountId);
	});

	test("setTenantState('stopped') stamps stopped_at; leaving it clears it", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
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
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await deleteTenant(db, accountId);
		expect(await getTenant(db, accountId)).toBeUndefined();
	});

	test("listTenants includes every inserted row", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		const rows = await listTenants(db);
		expect(rows.some((r) => r.account_id === accountId)).toBe(true);
		await deleteTenant(db, accountId);
	});
});
