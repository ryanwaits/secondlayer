import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "../index.ts";
import {
	createWebhook,
	deleteWebhook,
	getWebhook,
	getWebhookByName,
	getWebhookSigningSecret,
	listWebhooks,
	rotateWebhookSecret,
	toggleWebhookStatus,
	updateWebhook,
} from "./webhooks.ts";

// Requires local Postgres via `bun run db` and migrations applied.
// Account-scope tests need platform mode. Crypto still boots in tests.
process.env.INSTANCE_MODE = "platform";
process.env.SECONDLAYER_SECRETS_KEY =
	process.env.SECONDLAYER_SECRETS_KEY ??
	"0000000000000000000000000000000000000000000000000000000000000000";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();

let accountId: string;

beforeAll(async () => {
	// Minimal account row — the webhooks table references no FK on
	// accounts, so a real account isn't strictly required, but generate a
	// stable id for this test run so `account_id` filtering is meaningful.
	accountId = randomUUID();
});

afterAll(async () => {
	// Don't closeDb() — destroying the shared singleton breaks sibling
	// test files when `bun test` runs them together.
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

beforeEach(async () => {
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("webhooks queries", () => {
	const baseInput = () => ({
		accountId,
		name: "test-sub",
		subgraphName: "my-subgraph",
		tableName: "transfers",
		url: "https://webhook.site/abc",
	});

	it("create returns encrypted secret + plaintext once", async () => {
		const { webhook, signingSecret } = await createWebhook(db, baseInput());
		expect(webhook.id).toBeTruthy();
		expect(webhook.name).toBe("test-sub");
		expect(webhook.status).toBe("active");
		expect(webhook.format).toBe("standard-webhooks");
		expect(signingSecret).toMatch(/^[a-f0-9]{64}$/);
		expect(webhook.signing_secret_enc).toBeInstanceOf(Buffer);
		expect(getWebhookSigningSecret(webhook)).toBe(signingSecret);
	});

	it("create enforces unique (account_id, name)", async () => {
		await createWebhook(db, baseInput());
		await expect(createWebhook(db, baseInput())).rejects.toThrow();
	});

	it("list returns webhooks newest-first", async () => {
		const a = await createWebhook(db, { ...baseInput(), name: "a" });
		const b = await createWebhook(db, { ...baseInput(), name: "b" });
		const rows = await listWebhooks(db, accountId);
		expect(rows.length).toBe(2);
		expect(rows[0].id).toBe(b.webhook.id);
		expect(rows[1].id).toBe(a.webhook.id);
	});

	it("get by id scopes to account_id", async () => {
		const { webhook } = await createWebhook(db, baseInput());
		const found = await getWebhook(db, accountId, webhook.id);
		expect(found?.id).toBe(webhook.id);
		const missed = await getWebhook(db, randomUUID(), webhook.id);
		expect(missed).toBeNull();
	});

	it("get by name scopes to account_id", async () => {
		await createWebhook(db, baseInput());
		const found = await getWebhookByName(db, accountId, "test-sub");
		expect(found?.name).toBe("test-sub");
	});

	it("update patches url + format", async () => {
		const { webhook } = await createWebhook(db, baseInput());
		const patched = await updateWebhook(db, accountId, webhook.id, {
			url: "https://new.example/hook",
			format: "inngest",
			runtime: "inngest",
		});
		expect(patched?.url).toBe("https://new.example/hook");
		expect(patched?.format).toBe("inngest");
		expect(patched?.runtime).toBe("inngest");
	});

	it("toggleStatus pause resets circuit breaker", async () => {
		const { webhook } = await createWebhook(db, baseInput());
		await db
			.updateTable("webhooks")
			.set({ circuit_failures: 10, circuit_opened_at: new Date() })
			.where("id", "=", webhook.id)
			.execute();
		const resumed = await toggleWebhookStatus(
			db,
			accountId,
			webhook.id,
			"active",
		);
		expect(resumed?.status).toBe("active");
		expect(resumed?.circuit_failures).toBe(0);
		expect(resumed?.circuit_opened_at).toBeNull();
	});

	it("rotateSecret yields new plaintext + persists new envelope", async () => {
		const { webhook, signingSecret } = await createWebhook(db, baseInput());
		const rotated = await rotateWebhookSecret(db, accountId, webhook.id);
		if (!rotated) throw new Error("rotateWebhookSecret returned null");
		expect(rotated.signingSecret).not.toBe(signingSecret);
		expect(getWebhookSigningSecret(rotated.webhook)).toBe(
			rotated.signingSecret,
		);
	});

	it("delete removes the row + returns true", async () => {
		const { webhook } = await createWebhook(db, baseInput());
		const ok = await deleteWebhook(db, accountId, webhook.id);
		expect(ok).toBe(true);
		const after = await getWebhook(db, accountId, webhook.id);
		expect(after).toBeNull();
	});

	it("delete scoped to account_id", async () => {
		const { webhook } = await createWebhook(db, baseInput());
		const ok = await deleteWebhook(db, randomUUID(), webhook.id);
		expect(ok).toBe(false);
		const after = await getWebhook(db, accountId, webhook.id);
		expect(after).not.toBeNull();
	});

	it("creates a chain webhook (kind=chain, triggers persisted, no subgraph target)", async () => {
		const triggers = [
			{
				type: "contract_call",
				contractId: "SP123.amm",
				functionName: "swap-x-for-y",
			},
			{ type: "ft_transfer", trait: "sip-010", minAmount: "1000000" },
		];
		const { webhook, signingSecret } = await createWebhook(db, {
			accountId,
			name: "chain-sub",
			kind: "chain",
			triggers,
			url: "https://webhook.site/chain",
		});
		expect(webhook.kind).toBe("chain");
		expect(webhook.subgraph_name).toBeNull();
		expect(webhook.table_name).toBeNull();
		expect(webhook.triggers).toEqual(triggers);
		expect(signingSecret).toMatch(/^[a-f0-9]{64}$/);

		const fetched = await getWebhook(db, accountId, webhook.id);
		expect(fetched?.kind).toBe("chain");
		expect(fetched?.triggers).toEqual(triggers);
	});
});

describe("webhooks local namespace (oss)", () => {
	const prevMode = process.env.INSTANCE_MODE;

	afterAll(() => {
		process.env.INSTANCE_MODE = prevMode;
	});

	it("get/list/delete by name without an account", async () => {
		process.env.INSTANCE_MODE = "oss";
		await db.deleteFrom("webhooks").where("name", "=", "local-sub").execute();
		const { webhook } = await createWebhook(db, {
			accountId: "acct-leftover",
			name: "local-sub",
			subgraphName: "sg",
			tableName: "t",
			url: "https://example.com/hook",
		});
		expect(webhook.account_id).toBe("");

		const found = await getWebhook(db, "someone-else", webhook.id);
		expect(found?.name).toBe("local-sub");
		const byName = await getWebhookByName(db, "someone-else", "local-sub");
		expect(byName?.id).toBe(webhook.id);
		const listed = await listWebhooks(db, "someone-else");
		expect(listed.some((s) => s.name === "local-sub")).toBe(true);

		expect(await deleteWebhook(db, "someone-else", webhook.id)).toBe(true);
	});
});
