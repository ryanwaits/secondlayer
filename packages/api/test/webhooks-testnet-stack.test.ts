import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { Hono } from "hono";
import webhooksRouter from "../src/routes/webhooks.ts";

// Identity comes only from the x-secondlayer-account-id header, as the shared
// testnet stack receives it from the workload gateway. No accountId is injected
// into the Hono context, unlike the platform-mode harness in webhooks.test.ts.

const ACCOUNT_A = "348a0000-0000-4000-8000-00000000000a";
const ACCOUNT_B = "348b0000-0000-4000-8000-00000000000b";
const ACCOUNT_CAP = "348c0000-0000-4000-8000-00000000000c";
const ACCOUNT_FILLER = "348f0000-0000-4000-8000-00000000000f";
const ACCOUNTS = [ACCOUNT_A, ACCOUNT_B, ACCOUNT_CAP, ACCOUNT_FILLER];
const URL_OK = "https://example.com/hook";

const app = new Hono();
app.route("/webhooks", webhooksRouter);

function call(
	account: string | null,
	method: string,
	path: string,
	body?: unknown,
) {
	return app.request(`/webhooks${path}`, {
		method,
		headers: {
			...(account ? { "x-secondlayer-account-id": account } : {}),
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const original = {
	INSTANCE_MODE: process.env.INSTANCE_MODE,
	TESTNET_WEBHOOK_STACK: process.env.TESTNET_WEBHOOK_STACK,
	SECONDLAYER_SECRETS_KEY: process.env.SECONDLAYER_SECRETS_KEY,
};

function restore(key: keyof typeof original) {
	const value = original[key];
	if (value === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = value;
}

async function wipe() {
	const db = getDb();
	await db.deleteFrom("webhook_replays").execute();
	await db.deleteFrom("webhook_deliveries").execute();
	await db.deleteFrom("webhook_outbox").execute();
	await db.deleteFrom("webhooks").execute();
}

let aWebhookId = "";
let bWebhookId = "";
let aOutboxId = "";
let aDeliveryId = "";
const aReplayId = "348a348a348a348a";

test("DATABASE_URL is set", () => {
	expect(process.env.DATABASE_URL).toBeTruthy();
});

describe("testnet webhook stack", () => {
	beforeAll(async () => {
		if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
		process.env.INSTANCE_MODE = "oss";
		process.env.TESTNET_WEBHOOK_STACK = "true";
		process.env.SECONDLAYER_SECRETS_KEY ??= "0".repeat(64);

		const db = getDb();
		await wipe();
		await db
			.insertInto("accounts")
			.values(ACCOUNTS.map((id) => ({ id, email: `${id}@test.local` })))
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();

		const a = await createWebhook(db, {
			accountId: ACCOUNT_A,
			name: "shared-name",
			triggers: [{ type: "stx_transfer" }],
			url: URL_OK,
		});
		const b = await createWebhook(db, {
			accountId: ACCOUNT_B,
			name: "b-hook",
			triggers: [{ type: "stx_transfer" }],
			url: URL_OK,
		});
		aWebhookId = a.webhook.id;
		bWebhookId = b.webhook.id;

		const outbox = await db
			.insertInto("webhook_outbox")
			.values({
				webhook_id: aWebhookId,
				block_height: 10,
				tx_id: "0xabc",
				row_pk: { event_index: 0 },
				event_type: "stx_transfer",
				payload: { secret: "a-only" },
				dedup_key: "348-dedup-a",
				status: "dead",
				dead_reason: "exhausted",
				replay_id: aReplayId,
				failed_at: new Date(),
			} as never)
			.returning("id")
			.executeTakeFirstOrThrow();
		aOutboxId = outbox.id;
		const delivery = await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: aWebhookId,
				outbox_id: aOutboxId,
				attempt: 1,
				status_code: 500,
			} as never)
			.returning("id")
			.executeTakeFirstOrThrow();
		aDeliveryId = delivery.id;
		await db
			.insertInto("webhook_replays")
			.values({
				id: aReplayId,
				webhook_id: aWebhookId,
				from_block: 1,
				to_block: 10,
				status: "failed",
			} as never)
			.execute();
	});

	afterAll(async () => {
		await wipe();
		await getDb().deleteFrom("accounts").where("id", "in", ACCOUNTS).execute();
		restore("INSTANCE_MODE");
		restore("TESTNET_WEBHOOK_STACK");
		restore("SECONDLAYER_SECRETS_KEY");
	});

	async function expectAUntouched() {
		const db = getDb();
		const hook = await db
			.selectFrom("webhooks")
			.selectAll()
			.where("id", "=", aWebhookId)
			.executeTakeFirstOrThrow();
		expect(hook.account_id).toBe(ACCOUNT_A);
		expect(hook.name).toBe("shared-name");
		expect(hook.url).toBe(URL_OK);
		expect(hook.status).toBe("active");
		const dead = await db
			.selectFrom("webhook_outbox")
			.select(["status", "attempt"])
			.where("id", "=", aOutboxId)
			.executeTakeFirstOrThrow();
		expect(dead.status).toBe("dead");
		const replay = await db
			.selectFrom("webhook_replays")
			.select("status")
			.where("id", "=", aReplayId)
			.executeTakeFirstOrThrow();
		expect(replay.status).toBe("failed");
	}

	describe("identity", () => {
		test("a request without the account header is 401 on every verb", async () => {
			for (const [method, path] of [
				["GET", ""],
				["POST", ""],
				["GET", "/activity"],
				["GET", "/replays"],
				["GET", `/${aWebhookId}`],
				["DELETE", `/${aWebhookId}`],
			] as const) {
				const res = await call(
					null,
					method,
					path,
					method === "POST" ? { name: "x" } : undefined,
				);
				expect(res.status).toBe(401);
			}
			await expectAUntouched();
		});

		test("the same name under two accounts both succeed", async () => {
			const payload = {
				name: "shared-name",
				triggers: [{ type: "stx_transfer" }],
				url: URL_OK,
			};
			const res = await call(ACCOUNT_B, "POST", "", payload);
			expect(res.status).toBe(201);
			const dup = await call(ACCOUNT_B, "POST", "", payload);
			expect(dup.status).toBe(409);
			const body = (await res.json()) as { webhook: { id: string } };
			await call(ACCOUNT_B, "DELETE", `/${body.webhook.id}`);
		});

		test("rows are stored under the header's account, not the empty id", async () => {
			const row = await getDb()
				.selectFrom("webhooks")
				.select("account_id")
				.where("id", "=", bWebhookId)
				.executeTakeFirstOrThrow();
			expect(row.account_id).toBe(ACCOUNT_B);
		});
	});

	describe("account B cannot reach account A's webhook", () => {
		test("GET / lists only the caller's webhooks", async () => {
			const res = await call(ACCOUNT_B, "GET", "");
			const { data } = (await res.json()) as { data: { id: string }[] };
			expect(data.map((w) => w.id)).toEqual([bWebhookId]);
			const a = await call(ACCOUNT_A, "GET", "");
			const aData = ((await a.json()) as { data: { id: string }[] }).data;
			expect(aData.map((w) => w.id)).toEqual([aWebhookId]);
		});

		test("GET /activity covers only the caller's webhooks", async () => {
			const res = await call(ACCOUNT_B, "GET", "/activity");
			const body = (await res.json()) as { webhooks: { id: string }[] };
			expect(body.webhooks.map((w) => w.id)).toEqual([bWebhookId]);
		});

		test("GET /replays leaves out the other account's replays", async () => {
			const res = await call(ACCOUNT_B, "GET", "/replays");
			expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
			const own = await call(ACCOUNT_A, "GET", "/replays");
			expect(((await own.json()) as { data: unknown[] }).data).toHaveLength(1);
		});

		test("an account with no webhooks gets empty lists, not an unscoped query", async () => {
			const list = await call(ACCOUNT_CAP, "GET", "");
			expect(((await list.json()) as { data: [] }).data).toEqual([]);
			const activity = await call(ACCOUNT_CAP, "GET", "/activity");
			expect(((await activity.json()) as { webhooks: [] }).webhooks).toEqual(
				[],
			);
			const replays = await call(ACCOUNT_CAP, "GET", "/replays");
			expect(((await replays.json()) as { data: [] }).data).toEqual([]);
		});

		const idRoutes: Array<[string, string, () => string, unknown?]> = [
			["GET", "/:id", () => `/${aWebhookId}`],
			["PATCH", "/:id", () => `/${aWebhookId}`, { url: "https://evil.test/x" }],
			["POST", "/:id/pause", () => `/${aWebhookId}/pause`],
			["POST", "/:id/resume", () => `/${aWebhookId}/resume`],
			["POST", "/:id/rotate-secret", () => `/${aWebhookId}/rotate-secret`],
			["POST", "/:id/test", () => `/${aWebhookId}/test`],
			["GET", "/:id/deliveries", () => `/${aWebhookId}/deliveries`],
			["GET", "/:id/activity", () => `/${aWebhookId}/activity`],
			[
				"GET",
				"/:id/deliveries/:deliveryId",
				() => `/${aWebhookId}/deliveries/${aDeliveryId}`,
			],
			["GET", "/:id/dead", () => `/${aWebhookId}/dead`],
			[
				"POST",
				"/:id/dead/:outboxId/requeue",
				() => `/${aWebhookId}/dead/${aOutboxId}/requeue`,
			],
			["POST", "/:id/dead/requeue", () => `/${aWebhookId}/dead/requeue`, {}],
			["GET", "/:id/replays", () => `/${aWebhookId}/replays`],
			[
				"GET",
				"/:id/replays/:replayId",
				() => `/${aWebhookId}/replays/${aReplayId}`,
			],
			["DELETE", "/:id", () => `/${aWebhookId}`],
		];

		for (const [method, label, path, body] of idRoutes) {
			test(`${method} ${label} is 404 for B and leaves A's rows alone`, async () => {
				const res = await call(ACCOUNT_B, method, path(), body);
				expect(res.status).toBe(404);
				await expectAUntouched();
			});
		}

		test("POST /:id/replay is refused on testnet before any ownership lookup", async () => {
			const res = await call(ACCOUNT_B, "POST", `/${aWebhookId}/replay`, {
				fromBlock: 1,
				toBlock: 2,
			});
			expect(res.status).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"TESTNET_REPLAY_UNAVAILABLE",
			);
			const own = await call(ACCOUNT_A, "POST", `/${aWebhookId}/replay`, {
				fromBlock: 1,
				toBlock: 2,
			});
			expect(own.status).toBe(400);
			await expectAUntouched();
		});

		test("B's own webhook cannot requeue A's dead outbox row", async () => {
			const res = await call(
				ACCOUNT_B,
				"POST",
				`/${bWebhookId}/dead/${aOutboxId}/requeue`,
			);
			expect(res.status).toBe(404);
			await expectAUntouched();
		});

		test("B's bulk requeue naming A's replay id touches nothing of A's", async () => {
			const res = await call(ACCOUNT_B, "POST", `/${bWebhookId}/dead/requeue`, {
				replayId: aReplayId,
			});
			expect(res.status).toBe(200);
			expect(((await res.json()) as { requeued: number }).requeued).toBe(0);
			await expectAUntouched();
		});

		test("A can still read its own rows", async () => {
			const detail = await call(ACCOUNT_A, "GET", `/${aWebhookId}`);
			expect(detail.status).toBe(200);
			const delivery = await call(
				ACCOUNT_A,
				"GET",
				`/${aWebhookId}/deliveries/${aDeliveryId}`,
			);
			expect(delivery.status).toBe(200);
			const dead = await call(ACCOUNT_A, "GET", `/${aWebhookId}/dead`);
			expect(((await dead.json()) as { data: unknown[] }).data).toHaveLength(1);
		});
	});

	describe("testnet create rules", () => {
		test("ST and SN principals are accepted", async () => {
			for (const [i, contractId] of [
				"ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter",
				"SN1Z0WW5SMN4J99A1G1725PAB8H24Y1D0F9RS9NJ.counter",
			].entries()) {
				const res = await call(ACCOUNT_CAP, "POST", "", {
					name: `principal-${i}`,
					triggers: [{ type: "print_event", contractId }],
					url: URL_OK,
				});
				expect(res.status).toBe(201);
			}
			await getDb()
				.deleteFrom("webhooks")
				.where("account_id", "=", ACCOUNT_CAP)
				.execute();
		});

		test("trigger types outside the allowlist are 400 and name the index", async () => {
			for (const type of [
				"sbtc_deposit",
				"nested_contract_call",
				"var_set",
				"map_set",
				"rune_mint",
			]) {
				const res = await call(ACCOUNT_CAP, "POST", "", {
					name: `t-${type}`,
					triggers: [{ type: "stx_transfer" }, { type }],
					url: URL_OK,
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as { error: string };
				expect(body.error).toContain("triggers[1]");
			}
		});

		test("a trigger with a trait is 400", async () => {
			const res = await call(ACCOUNT_CAP, "POST", "", {
				name: "traity",
				triggers: [{ type: "contract_call", trait: "SP000.sip-010.ft" }],
				url: URL_OK,
			});
			expect(res.status).toBe(400);
			expect(((await res.json()) as { error: string }).error).toContain(
				"triggers[0]",
			);
		});

		test("more than 5 triggers is 400", async () => {
			const res = await call(ACCOUNT_CAP, "POST", "", {
				name: "many",
				triggers: Array.from({ length: 6 }, () => ({ type: "stx_transfer" })),
				url: URL_OK,
			});
			expect(res.status).toBe(400);
		});

		test("concurrency above 5 is 400 on create and patch", async () => {
			const create = await call(ACCOUNT_CAP, "POST", "", {
				name: "busy",
				triggers: [{ type: "stx_transfer" }],
				url: URL_OK,
				concurrency: 6,
			});
			expect(create.status).toBe(400);
			const patch = await call(ACCOUNT_B, "PATCH", `/${bWebhookId}`, {
				concurrency: 6,
			});
			expect(patch.status).toBe(400);
			const ok = await call(ACCOUNT_B, "PATCH", `/${bWebhookId}`, {
				concurrency: 5,
			});
			expect(ok.status).toBe(200);
		});

		test("the 11th webhook of an account is TESTNET_WEBHOOK_LIMIT", async () => {
			for (let i = 0; i < 10; i++) {
				const res = await call(ACCOUNT_CAP, "POST", "", {
					name: `cap-${i}`,
					triggers: [{ type: "stx_transfer" }],
					url: URL_OK,
				});
				expect(res.status).toBe(201);
			}
			const res = await call(ACCOUNT_CAP, "POST", "", {
				name: "cap-10",
				triggers: [{ type: "stx_transfer" }],
				url: URL_OK,
			});
			expect(res.status).toBe(400);
			expect(((await res.json()) as { code: string }).code).toBe(
				"TESTNET_WEBHOOK_LIMIT",
			);
			// Paused webhooks count toward the limit.
			await getDb()
				.updateTable("webhooks")
				.set({ status: "paused", pause_reason: "user" })
				.where("account_id", "=", ACCOUNT_CAP)
				.execute();
			const paused = await call(ACCOUNT_CAP, "POST", "", {
				name: "cap-11",
				triggers: [{ type: "stx_transfer" }],
				url: URL_OK,
			});
			expect(paused.status).toBe(400);
			await getDb()
				.deleteFrom("webhooks")
				.where("account_id", "=", ACCOUNT_CAP)
				.execute();
		});

		test("the 501st webhook on the stack is 503 TESTNET_CAPACITY", async () => {
			const db = getDb();
			const existing = Number(
				(
					await db
						.selectFrom("webhooks")
						.select(db.fn.countAll<string>().as("n"))
						.executeTakeFirstOrThrow()
				).n,
			);
			for (let i = existing; i < 500; i++) {
				await createWebhook(db, {
					accountId: ACCOUNT_FILLER,
					name: `filler-${i}`,
					triggers: [{ type: "stx_transfer" }],
					url: URL_OK,
				});
			}
			const res = await call(ACCOUNT_CAP, "POST", "", {
				name: "one-too-many",
				triggers: [{ type: "stx_transfer" }],
				url: URL_OK,
			});
			expect(res.status).toBe(503);
			expect(((await res.json()) as { code: string }).code).toBe(
				"TESTNET_CAPACITY",
			);
			await db
				.deleteFrom("webhooks")
				.where("account_id", "=", ACCOUNT_FILLER)
				.execute();
		});
	});
});

describe("with the testnet flag off", () => {
	beforeAll(async () => {
		if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
		process.env.INSTANCE_MODE = "oss";
		Reflect.deleteProperty(process.env, "TESTNET_WEBHOOK_STACK");
		process.env.SECONDLAYER_SECRETS_KEY ??= "0".repeat(64);
		await wipe();
	});

	afterAll(async () => {
		await wipe();
		restore("INSTANCE_MODE");
		restore("TESTNET_WEBHOOK_STACK");
		restore("SECONDLAYER_SECRETS_KEY");
	});

	test("a create needs no header, stores the empty account id, and allows sBTC triggers", async () => {
		const res = await call(null, "POST", "", {
			name: "sbtc",
			triggers: [{ type: "sbtc_deposit" }],
			url: URL_OK,
		});
		expect(res.status).toBe(201);
		const row = await getDb()
			.selectFrom("webhooks")
			.select("account_id")
			.executeTakeFirstOrThrow();
		expect(row.account_id).toBe("");
	});

	test("the account header is ignored: every webhook is visible", async () => {
		const res = await call(ACCOUNT_B, "GET", "");
		expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1);
	});

	test("replay is not refused by the testnet rule", async () => {
		const res = await call(null, "POST", `/${crypto.randomUUID()}/replay`, {
			fromBlock: 1,
			toBlock: 2,
		});
		expect(res.status).toBe(404);
	});
});
