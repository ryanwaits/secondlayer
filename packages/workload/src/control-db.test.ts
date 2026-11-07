import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
	API_PORT_MAX,
	SUBNET_IDX_MAX,
	TENANT_TRANSITIONS,
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
	transitionTenant,
} from "./control-db.ts";
import { TENANT_NETWORK_CAPACITY } from "./provisioner.ts";
import { forceTenantState } from "./tenant-fixture.ts";

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

/** postgres.js queries are lazy thenables; `rejects` needs a real promise. */
async function run(query: PromiseLike<unknown>): Promise<void> {
	await query;
}

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

	test("transitionTenant stamps stopped_at and the reason on stop, and clears both on start", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		const running = await transitionTenant(db, accountId, {
			from: ["provisioning"],
			to: "running",
		});
		expect(running?.state).toBe("running");
		expect(running?.started_at).not.toBeNull();

		const stopped = await transitionTenant(db, accountId, {
			from: ["running"],
			to: "stopped",
			reason: "cap",
		});
		expect(stopped?.state).toBe("stopped");
		expect(stopped?.stopped_at).not.toBeNull();
		expect(stopped?.stop_reason).toBe("cap");

		const again = await transitionTenant(db, accountId, {
			from: ["stopped"],
			to: "running",
		});
		expect(again?.stopped_at).toBeNull();
		expect(again?.stop_reason).toBeNull();

		await deleteTenant(db, accountId);
	});

	test("transitionTenant returns null when the row is not in a from state", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		expect(
			await transitionTenant(db, accountId, {
				from: ["running"],
				to: "stopped",
				reason: "idle",
			}),
		).toBeNull();
		expect((await getTenant(db, accountId))?.state).toBe("provisioning");
		expect(
			await transitionTenant(db, crypto.randomUUID(), {
				from: ["running"],
				to: "stopped",
				reason: "idle",
			}),
		).toBeNull();

		await deleteTenant(db, accountId);
	});

	test("two racing stops: exactly one wins", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await forceTenantState(db, accountId, "running");

		const results = await Promise.all(
			(["credits", "idle"] as const).map((reason) =>
				transitionTenant(db, accountId, {
					from: ["running"],
					to: "stopped",
					reason,
				}),
			),
		);
		expect(results.filter(Boolean)).toHaveLength(1);

		await deleteTenant(db, accountId);
	});

	test("transitionTenant with ifStartedAt only moves the stack that came up when it was read", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await forceTenantState(db, accountId, "running");
		const seen = (await getTenant(db, accountId))?.started_at ?? null;
		await db`UPDATE tenants SET started_at = now() + interval '1 second' WHERE account_id = ${accountId}`;

		expect(
			await transitionTenant(db, accountId, {
				from: ["running"],
				to: "stopped",
				reason: "idle",
				ifStartedAt: seen,
			}),
		).toBeNull();
		const current = (await getTenant(db, accountId))?.started_at ?? null;
		expect(
			await transitionTenant(db, accountId, {
				from: ["running"],
				to: "stopped",
				reason: "idle",
				ifStartedAt: current,
			}),
		).not.toBeNull();

		await deleteTenant(db, accountId);
	});

	test("transitionTenant refuses a move the machine does not allow, and a stop without a reason", async () => {
		const accountId = crypto.randomUUID();
		await expect(
			transitionTenant(db, accountId, { from: ["destroyed"], to: "running" }),
		).rejects.toThrow("illegal transition destroyed -> running");
		await expect(
			transitionTenant(db, accountId, { from: ["running"], to: "stopped" }),
		).rejects.toThrow("stop reason");
		expect(TENANT_TRANSITIONS.canTransition("destroyed", "provisioning")).toBe(
			false,
		);
	});

	test("the database rejects a stopped tenant without a reason, a reason on a running one, and an unknown state", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		await expect(
			run(
				db`UPDATE tenants SET state = 'stopped', stop_reason = NULL WHERE account_id = ${accountId}`,
			),
		).rejects.toThrow("tenants_stopped_has_reason_check");
		await expect(
			run(
				db`UPDATE tenants SET state = 'running', stop_reason = 'idle' WHERE account_id = ${accountId}`,
			),
		).rejects.toThrow("tenants_stopped_has_reason_check");
		await expect(
			run(
				db`UPDATE tenants SET state = 'paused' WHERE account_id = ${accountId}`,
			),
		).rejects.toThrow("tenants_state_check");
		await expect(
			run(
				db`UPDATE tenants SET state = 'stopped', stop_reason = 'bored' WHERE account_id = ${accountId}`,
			),
		).rejects.toThrow("tenants_stop_reason_check");

		await deleteTenant(db, accountId);
	});

	test("the pool CHECKs reject an out-of-range subnet index and api port", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		try {
			for (const idx of [0, SUBNET_IDX_MAX + 1]) {
				await expect(
					run(
						db`UPDATE tenants SET subnet_idx = ${idx} WHERE account_id = ${accountId}`,
					),
				).rejects.toThrow("tenants_subnet_idx_range_check");
			}
			for (const port of [19999, API_PORT_MAX + 1]) {
				await expect(
					run(
						db`UPDATE tenants SET api_port = ${port} WHERE account_id = ${accountId}`,
					),
				).rejects.toThrow("tenants_api_port_range_check");
			}
			// The bounds themselves are allowed.
			await db`UPDATE tenants SET subnet_idx = ${SUBNET_IDX_MAX}, api_port = ${API_PORT_MAX} WHERE account_id = ${accountId}`;
		} finally {
			await deleteTenant(db, accountId);
		}
	});

	test("the pools are sequences that stop at their cap instead of cycling", async () => {
		const rows = await db<
			{ sequencename: string; max_value: string; cycle: boolean }[]
		>`
			SELECT sequencename, max_value, cycle FROM pg_sequences
			WHERE sequencename IN ('tenant_subnet_seq', 'tenant_api_port_seq')
		`;
		const byName = Object.fromEntries(rows.map((r) => [r.sequencename, r]));
		expect(Number(byName.tenant_subnet_seq?.max_value)).toBe(SUBNET_IDX_MAX);
		expect(byName.tenant_subnet_seq?.cycle).toBe(false);
		expect(Number(byName.tenant_api_port_seq?.max_value)).toBe(API_PORT_MAX);
		expect(byName.tenant_api_port_seq?.cycle).toBe(false);
	});

	test("the subnet cap matches the networks tenantNetwork can address", () => {
		expect(SUBNET_IDX_MAX).toBe(TENANT_NETWORK_CAPACITY - 1);
	});

	test("ensureControlSchema adds the range check NOT VALID, without failing, when an old row is outside it", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await db`ALTER TABLE tenants DROP CONSTRAINT tenants_api_port_range_check`;
		try {
			await db`UPDATE tenants SET api_port = 5 WHERE account_id = ${accountId}`;
			await ensureControlSchema(db);
			const [check] = await db<{ convalidated: boolean }[]>`
				SELECT convalidated FROM pg_constraint WHERE conname = 'tenants_api_port_range_check'
			`;
			expect(check?.convalidated).toBe(false);
			// New rows are still held to the range.
			await expect(
				run(
					db`UPDATE tenants SET api_port = 6 WHERE account_id = ${accountId}`,
				),
			).rejects.toThrow("tenants_api_port_range_check");
		} finally {
			await deleteTenant(db, accountId);
			await db`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_api_port_range_check`;
			await ensureControlSchema(db);
		}
	});

	test("ensureControlSchema repairs a stopped row with no reason before adding the check", async () => {
		const accountId = crypto.randomUUID();
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await db`ALTER TABLE tenants DROP CONSTRAINT tenants_stopped_has_reason_check`;
		try {
			await db`UPDATE tenants SET state = 'stopped', stop_reason = NULL, stopped_at = now() WHERE account_id = ${accountId}`;
			await ensureControlSchema(db);
			expect((await getTenant(db, accountId))?.stop_reason).toBe("credits");
		} finally {
			await ensureControlSchema(db);
			await deleteTenant(db, accountId);
		}
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

		await forceTenantState(db, accountId, "running");
		pollable = await listPollableTenants(db);
		expect(pollable.some((r) => r.account_id === accountId)).toBe(true);

		await forceTenantState(db, accountId, "stopped");
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

	test("tenants from before has_subgraphs existed keep the subgraph floor; new tenants start webhook-only", async () => {
		const before = crypto.randomUUID();
		await db`ALTER TABLE tenants DROP COLUMN IF EXISTS has_subgraphs`;
		await insertProvisioningTenant(db, before, acct8For(before));
		await ensureControlSchema(db);
		const after = crypto.randomUUID();
		await insertProvisioningTenant(db, after, acct8For(after));

		// They all run a processor today: true until the reconcile removes it.
		expect((await getTenant(db, before))?.has_subgraphs).toBe(true);
		expect((await getTenant(db, after))?.has_subgraphs).toBe(false);

		await deleteTenant(db, before);
		await deleteTenant(db, after);
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

		await forceTenantState(db, accountId, "running");
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

		await forceTenantState(db, accountId, "running");
		expect(
			(await listRunningTenants(db)).some((r) => r.account_id === accountId),
		).toBe(true);

		await forceTenantState(db, accountId, "stopped");
		expect(
			(await listRunningTenants(db)).some((r) => r.account_id === accountId),
		).toBe(false);

		await deleteTenant(db, accountId);
	});
});
