import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
	listPollableTenants,
	listRunningTenants,
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
		// Both callers agree on the same allocated port — nobody double-allocates.
		expect(first.apiPort).toBe(second.apiPort);

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("provisioning");
		expect(row?.api_port).toBe(first.apiPort);

		await deleteTenant(db, accountId);
	});

	test("two different accounts never get the same api_port", async () => {
		const a = `test-${crypto.randomUUID()}`;
		const b = `test-${crypto.randomUUID()}`;
		const resultA = await insertProvisioningTenant(db, a, acct8For(a));
		const resultB = await insertProvisioningTenant(db, b, acct8For(b));
		expect(resultA.apiPort).not.toBe(resultB.apiPort);
		await deleteTenant(db, a);
		await deleteTenant(db, b);
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

	test("listPollableTenants includes running/stopped, excludes provisioning", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
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

	test("listRunningTenants excludes stopped and provisioning", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
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
