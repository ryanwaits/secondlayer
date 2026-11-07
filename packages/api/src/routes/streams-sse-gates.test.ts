import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	GHOST_ACCOUNT_ROWS_LIMIT,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
} from "@secondlayer/platform/billing/prices";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { hashToken } from "../auth/keys.ts";
import { _resetSlotCounterForTests } from "../lib/slot-counter.ts";
import { errorHandler } from "../middleware/error.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "../streams/auth.ts";
import { StreamsResponseCache } from "../streams/response-cache.ts";
import type { StreamsTip } from "../streams/tip.ts";
import { createStreamsRouter } from "./streams.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const TIP: StreamsTip = {
	block_height: 200,
	block_hash: "0xtip",
	burn_block_height: 300,
	finalized_height: 150,
	lag_seconds: 2,
};

function eventAt(n: number) {
	return {
		cursor: `${100 + n}:0`,
		block_height: 100 + n,
		block_hash: `0xb${100 + n}`,
		burn_block_height: 250,
		tx_id: `0xtx${n}`,
		tx_index: 0,
		event_index: 0,
		event_type: "stx_transfer" as const,
		contract_id: null,
		payload: { amount: "1", sender: "SP1", recipient: "SP2" },
		ts: "2026-06-05T00:00:00.000Z",
	};
}

type Frame = { event?: string; data?: string };

/** Read SSE frames until the server ends the stream or `ms` passes. */
async function readFrames(res: Response, ms: number) {
	if (!res.body) throw new Error("no body");
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const frames: Frame[] = [];
	let buffer = "";
	let ended = false;
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const next = await Promise.race([
			reader.read(),
			new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())),
			),
		]);
		if (next === null) break;
		if (next.done) {
			ended = true;
			break;
		}
		buffer += decoder.decode(next.value, { stream: true });
		let sep = buffer.indexOf("\n\n");
		while (sep !== -1) {
			const raw = buffer.slice(0, sep);
			buffer = buffer.slice(sep + 2);
			const frame: Frame = {};
			for (const line of raw.split("\n")) {
				if (line.startsWith("event: ")) frame.event = line.slice(7);
				else if (line.startsWith("data: ")) frame.data = line.slice(6);
			}
			frames.push(frame);
			sep = buffer.indexOf("\n\n");
		}
	}
	await reader.cancel().catch(() => {});
	return { frames, ended };
}

const endFrame = (frames: Frame[]) => frames.find((f) => f.event === "end");

describe.skipIf(!HAS_DB)(
	"SSE keeps checking the account while it streams (DB)",
	() => {
		const db = HAS_DB ? getDb() : (null as never);
		const accountIds: string[] = [];
		let prevMode: string | undefined;

		beforeAll(() => {
			prevMode = process.env.INSTANCE_MODE;
			process.env.INSTANCE_MODE = "platform";
		});
		afterAll(async () => {
			if (prevMode === undefined)
				Reflect.deleteProperty(process.env, "INSTANCE_MODE");
			else process.env.INSTANCE_MODE = prevMode;
			if (accountIds.length > 0) {
				await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
			}
			await _resetSlotCounterForTests();
		});

		async function makeAccount(): Promise<string> {
			const row = await db
				.insertInto("accounts")
				.values({ email: `sse-gates-${crypto.randomUUID()}@example.com` })
				.returning("id")
				.executeTakeFirstOrThrow();
			accountIds.push(row.id);
			return row.id;
		}

		async function makeKey(accountId: string): Promise<string> {
			const raw = `sk-sl_sse_${crypto.randomUUID()}`;
			const row = await db
				.insertInto("api_keys")
				.values({
					key_hash: hashToken(raw),
					key_prefix: raw.slice(0, 14),
					account_id: accountId,
					ip_address: "test",
					product: "account",
					tier: "free",
					status: "active",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			return row.id;
		}

		function app(
			tenant: { account_id: string; api_key_id?: string },
			sse: { recheckMs?: number; maxAgeMs?: number } = {},
		) {
			const tokens: StreamsTokenStore = {
				get: () => ({
					tenant_id: `account:${tenant.account_id}`,
					account_id: tenant.account_id,
					api_key_id: tenant.api_key_id,
					tier: "free",
					scopes: [STREAMS_READ_SCOPE],
				}),
			};
			let n = 0;
			const router = createStreamsRouter({
				tokens,
				getTip: () => TIP,
				// One new event per poll, forever: only the gates can end the stream.
				readEvents: async () => {
					n += 1;
					return { events: [eventAt(n)], next_cursor: eventAt(n).cursor };
				},
				readReorgs: async () => [],
				responseCache: new StreamsResponseCache(),
				sse: { pollMs: 20, recheckMs: 0, ...sse },
			});
			const a = new Hono();
			a.onError(errorHandler);
			a.route("/", router);
			return a;
		}

		const open = (a: Hono) =>
			a.request("/events/stream", {
				headers: { authorization: "Bearer sk-sl_anything" },
			});

		test("an account that runs through its allowance mid-stream gets the refusal and the stream ends", async () => {
			const accountId = await makeAccount();
			// One row under the allowance with no balance: the connection opens,
			// and its first page uses the allowance up.
			await meter(db, {
				accountId,
				unit: "rows.delivered",
				quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE - 1,
				source: "test-seed",
				idempotencyKey: `seed-${accountId}`,
				occurredAt: new Date(),
			});

			const res = await open(app({ account_id: accountId }));
			expect(res.status).toBe(200);
			const { frames, ended } = await readFrames(res, 3_000);

			expect(ended).toBe(true);
			const end = endFrame(frames);
			expect(end).toBeDefined();
			expect(JSON.parse(end?.data ?? "{}")).toMatchObject({
				reason: "insufficient_credits",
			});
		});

		test("a docs key stops at its rows limit even between rechecks", async () => {
			const accountId = await makeAccount();
			await db
				.updateTable("accounts")
				.set({ ghost: true, email: null })
				.where("id", "=", accountId)
				.execute();
			await meter(db, {
				accountId,
				unit: "rows.delivered",
				quantity: GHOST_ACCOUNT_ROWS_LIMIT - 1,
				source: "test-seed",
				idempotencyKey: `seed-${accountId}`,
				occurredAt: new Date(),
			});

			const res = await open(
				app({ account_id: accountId }, { recheckMs: 60_000 }),
			);
			expect(res.status).toBe(200);
			const { frames, ended } = await readFrames(res, 3_000);

			expect(ended).toBe(true);
			expect(JSON.parse(endFrame(frames)?.data ?? "{}")).toMatchObject({
				reason: "rows_limit_reached",
			});
			// One page past the limit at most: the page that crossed it.
			expect(frames.filter((f) => f.event === undefined)).toHaveLength(1);
		});

		test("a key revoked mid-stream ends the stream", async () => {
			const accountId = await makeAccount();
			const keyId = await makeKey(accountId);
			const a = app({ account_id: accountId, api_key_id: keyId });

			const res = await open(a);
			expect(res.status).toBe(200);
			await db
				.updateTable("api_keys")
				.set({ status: "revoked", revoked_at: new Date() })
				.where("id", "=", keyId)
				.execute();
			const { frames, ended } = await readFrames(res, 3_000);

			expect(ended).toBe(true);
			expect(JSON.parse(endFrame(frames)?.data ?? "{}")).toMatchObject({
				reason: "key_revoked",
			});
		});

		test("a connection ends once it passes its age limit and says so", async () => {
			const accountId = await makeAccount();
			const res = await open(app({ account_id: accountId }, { maxAgeMs: 150 }));
			const { frames, ended } = await readFrames(res, 3_000);

			expect(ended).toBe(true);
			expect(JSON.parse(endFrame(frames)?.data ?? "{}")).toMatchObject({
				reason: "max_age",
			});
		});

		test("a fourth live connection for one account is refused and a closed one frees its slot", async () => {
			const accountId = await makeAccount();
			const a = app({ account_id: accountId });

			const open3 = [await open(a), await open(a), await open(a)];
			expect(open3.map((r) => r.status)).toEqual([200, 200, 200]);

			const fourth = await open(a);
			expect(fourth.status).toBe(429);
			expect(fourth.headers.get("retry-after")).toBeTruthy();

			await open3[0]?.body?.cancel();
			// The loop notices the hang-up on its next poll.
			await new Promise((resolve) => setTimeout(resolve, 200));
			const retry = await open(a);
			expect(retry.status).toBe(200);

			for (const r of [...open3.slice(1), retry]) await r.body?.cancel();
		});
	},
);
