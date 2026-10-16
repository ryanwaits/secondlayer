import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.ts";
import { jsonb } from "../db/jsonb.ts";
import { evaluateTenantInsights } from "./evaluate.ts";
import { listInsights } from "./store.ts";
import { createAbiCache } from "./webhook-rules.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const tag = `ev${randomUUID().slice(0, 8)}`;
const account = `acct-${tag}`;
const NOW = new Date();

const webhookName = `${tag}-hook`;
const subgraphName = `${tag}-sg`;
let webhookId = "";
let subgraphId = "";

const NO_ENV = {};
const noFetch = (async () => {
	throw new Error("no network in tests");
}) as unknown as typeof fetch;

async function pass(
	env: Record<string, string | undefined> = NO_ENV,
	fetchImpl = noFetch,
) {
	await evaluateTenantInsights(db, {
		now: new Date(),
		env,
		fetchImpl,
		abiCache: createAbiCache(),
	});
}

async function mine() {
	const all = await listInsights(db, { accountId: null }, new Date());
	return all.filter((i) =>
		[webhookName, subgraphName].includes(i.resource.name),
	);
}

afterAll(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("insights")
		.where("resource_id", "in", [webhookId, subgraphName])
		.execute();
	await db.deleteFrom("webhooks").where("account_id", "=", account).execute();
	await db.deleteFrom("subgraphs").where("account_id", "=", account).execute();
});

describe.skipIf(!HAS_DB)("evaluateTenantInsights", () => {
	test("fires webhook and subgraph insights from live tables, then resolves them", async () => {
		const wh = await db
			.insertInto("webhooks")
			.values({
				account_id: account,
				name: webhookName,
				url: "https://hooks.example.dev/in",
				triggers: jsonb([{ type: "stx_transfer" }]),
				signing_secret_enc: Buffer.from("x"),
				timeout_ms: 10000,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		webhookId = wh.id;

		const base = NOW.getTime();
		for (let i = 0; i < 6; i++) {
			await db
				.insertInto("webhook_deliveries")
				.values({
					webhook_id: webhookId,
					attempt: 1,
					status_code: 502,
					response_body: "Bad Gateway",
					duration_ms: 20,
					dispatched_at: new Date(base - (i + 1) * 60_000),
				})
				.execute();
		}

		const sg = await db
			.insertInto("subgraphs")
			.values({
				name: subgraphName,
				definition: jsonb({}),
				schema_hash: "h",
				handler_path: "/h",
				account_id: account,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		subgraphId = sg.id;
		const snapshots = [
			{ ago: 23 * 3600_000, errors: 0, block: 1000 },
			{ ago: 600_000, errors: 25, block: 900 },
			{ ago: 400_000, errors: 25, block: 900 },
			{ ago: 200_000, errors: 25, block: 900 },
		];
		for (const s of snapshots) {
			await db
				.insertInto("subgraph_health_snapshots")
				.values({
					subgraph_id: subgraphId,
					total_processed: 0,
					total_errors: s.errors,
					last_processed_block: s.block,
					chain_tip: 1000,
					captured_at: new Date(base - s.ago),
				})
				.execute();
		}
		await db
			.insertInto("subgraph_error_groups")
			.values({
				subgraph_name: subgraphName,
				fingerprint: "fp",
				source_name: "transfers",
				event_type: "ft_transfer",
				message: "boom",
				count: 25,
			})
			.execute();

		await pass();
		const rules = (await mine())
			.map((i) => `${i.resource.kind}:${i.rule}`)
			.sort();
		expect(rules).toEqual([
			"subgraph:subgraph_handler_errors",
			"subgraph:subgraph_lag",
			"webhook:receiver_down",
		]);

		// The webhook recovers: a success is now the newest attempt.
		await db
			.insertInto("webhook_deliveries")
			.values({
				webhook_id: webhookId,
				attempt: 1,
				status_code: 200,
				duration_ms: 20,
			})
			.execute();
		await pass();
		let down = (await mine()).find((i) => i.rule === "receiver_down");
		expect(down?.severity).not.toBe("recovered");
		await pass();
		down = (await mine()).find((i) => i.rule === "receiver_down");
		expect(down?.severity).toBe("recovered");
	});

	test("a deleted webhook's insight resolves after two passes", async () => {
		await db.deleteFrom("webhooks").where("id", "=", webhookId).execute();
		await db
			.insertInto("insights")
			.values({
				account_id: null,
				resource_kind: "webhook",
				resource_id: webhookId,
				rule: "receiver_rejects",
				severity: "losing",
				payload: jsonb({
					resource: { kind: "webhook", id: webhookId, name: webhookName },
					line: "l",
					lead: "l",
					body: "b",
					evidence: [],
					handoff: { prompt: "p", commands: [] },
					how: { detector: "d", facts: [] },
				}),
			})
			.execute();
		await pass();
		await pass();
		const row = (await mine()).find((i) => i.rule === "receiver_rejects");
		expect(row?.severity).toBe("recovered");
	});

	test("filter_cant_match is skipped, not cleared, when the ABI lookup is off", async () => {
		const wh = await db
			.insertInto("webhooks")
			.values({
				account_id: account,
				name: `${tag}-abi`,
				url: "https://hooks.example.dev/abi",
				triggers: jsonb([
					{
						type: "contract_call",
						contractId: "SP1.pool",
						functionName: "nope",
					},
				]),
				signing_secret_enc: Buffer.from("x"),
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		try {
			const abiFetch = (async () =>
				new Response(
					JSON.stringify({
						contract: { abi: { functions: [{ name: "deposit" }] } },
					}),
					{ status: 200 },
				)) as unknown as typeof fetch;
			const env = {
				STREAMS_API_URL: "http://index",
				INDEX_INTERNAL_API_KEY: "k",
			};
			await pass(env, abiFetch);
			const open = async () =>
				(await listInsights(db, { accountId: null }, new Date())).find(
					(i) => i.resource.id === wh.id && i.rule === "filter_cant_match",
				);
			expect((await open())?.severity).toBe("will_fail");

			// Lookup unavailable twice over: nothing fires, nothing clears.
			await pass(NO_ENV);
			await pass(NO_ENV);
			expect((await open())?.severity).toBe("will_fail");
		} finally {
			await db
				.deleteFrom("insights")
				.where("resource_id", "=", wh.id)
				.execute();
			await db.deleteFrom("webhooks").where("id", "=", wh.id).execute();
		}
	});
});
