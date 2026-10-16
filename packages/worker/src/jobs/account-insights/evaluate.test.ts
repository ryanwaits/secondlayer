import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { listInsights } from "@secondlayer/shared/insights";
import { evaluateAccountInsights } from "./evaluate.ts";
import { listActiveAccountIds } from "./load.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

afterAll(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("insights")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("account_credits")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_failed_requests")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

function logRow(accountId: string, over: Record<string, unknown>) {
	return {
		request_id: null,
		account_id: accountId,
		api_key_id: null,
		method: "GET",
		path: "/v1/index/ft-transfers",
		path_template: "/v1/index/ft-transfers",
		params_hash: "p1",
		cursor_hash: null,
		page_size: 1000,
		rows: 1000,
		status: 200,
		duration_ms: 12,
		...over,
	};
}

describe.skipIf(!HAS_DB)("evaluateAccountInsights", () => {
	test("fires from the real tables, scoped to the account, then clears", async () => {
		const accountId = await makeAccount();
		const bystander = await makeAccount();

		// Two identical 3-page reads, 20 minutes apart.
		for (const startAgo of [50, 30]) {
			for (const [i, rows] of [1000, 1000, 587].entries()) {
				await db
					.insertInto("api_request_log")
					.values(
						logRow(accountId, {
							created_at: new Date(minutesAgo(startAgo).getTime() + i * 1000),
							cursor_hash: i === 0 ? null : `c${i}`,
							rows,
						}),
					)
					.execute();
			}
		}
		// Three server errors in the last hour.
		for (let i = 0; i < 3; i++) {
			await db
				.insertInto("api_failed_requests")
				.values({
					request_id: `req_${randomUUID()}`,
					account_id: accountId,
					method: "GET",
					path: "/v1/index/blocks",
					status: 503,
					code: "UNAVAILABLE",
					query: {},
					created_at: minutesAgo(10 + i),
				})
				.execute();
		}
		// A funded balance, so the runway rule stays quiet here.
		await db
			.insertInto("account_credits")
			.values({ account_id: accountId, balance_usd_micros: "100000000" })
			.execute();
		// A paid read: the allowance is gone.
		await db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit: "rows.delivered",
				quantity: "1000",
				usd_micros: "5000",
				source: "test",
				idempotency_key: `idem-${randomUUID()}`,
			})
			.execute();

		await evaluateAccountInsights(db, accountId);

		const mine = await listInsights(db, { accountId });
		expect(mine.map((i) => i.rule).sort()).toEqual([
			"allowance_exhausted",
			"duplicate_reads",
			"server_errors",
		]);
		expect(mine[0]?.rule).toBe("server_errors");
		expect(mine.every((i) => i.resource.kind === "account")).toBe(true);
		expect(await listInsights(db, { accountId: bystander })).toEqual([]);
		expect(
			await listInsights(db, { accountId: null }).then((all) =>
				all.filter(
					(i) => i.rule === "server_errors" && i.resource.id === "account",
				),
			),
		).toEqual([]);

		// The 5xx rows age out of the hour: two clean passes resolve the card.
		await db
			.deleteFrom("api_failed_requests")
			.where("account_id", "=", accountId)
			.execute();
		await evaluateAccountInsights(db, accountId);
		await evaluateAccountInsights(db, accountId);
		const after = await listInsights(db, { accountId });
		expect(after.find((i) => i.rule === "server_errors")?.severity).toBe(
			"recovered",
		);
		expect(after.find((i) => i.rule === "duplicate_reads")?.severity).toBe(
			"costs",
		);
	});

	test("loads a spend cap and balance into the billing rules", async () => {
		const accountId = await makeAccount();
		await db
			.insertInto("account_credits")
			.values({ account_id: accountId, balance_usd_micros: "3000000" })
			.execute();
		await db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit: "webhook.event",
				quantity: "1",
				usd_micros: "1000000",
				source: "test",
				idempotency_key: `idem-${randomUUID()}`,
				occurred_at: minutesAgo(30),
			})
			.execute();

		await evaluateAccountInsights(db, accountId);

		const runway = (await listInsights(db, { accountId })).find(
			(i) => i.rule === "credits_runway",
		);
		expect(runway?.severity).toBe("will_fail");
		expect(runway?.handoff.commands).toEqual(["sl credits buy"]);
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
	});

	test("lists accounts with recent activity or an open insight, not idle ones", async () => {
		const active = await makeAccount();
		const idle = await makeAccount();
		const stale = await makeAccount();
		await db
			.insertInto("api_request_log")
			.values(logRow(active, { created_at: minutesAgo(5) }))
			.execute();
		await db
			.insertInto("api_request_log")
			.values(
				logRow(stale, { created_at: new Date(Date.now() - 3 * 86_400_000) }),
			)
			.execute();

		const ids = await listActiveAccountIds(db);
		expect(ids).toContain(active);
		expect(ids).not.toContain(idle);
		expect(ids).not.toContain(stale);

		// An open insight keeps an otherwise idle account in the pass.
		await db
			.insertInto("insights")
			.values({
				account_id: idle,
				resource_kind: "account",
				resource_id: "account",
				rule: "server_errors",
				severity: "losing",
				payload: JSON.stringify({}) as never,
			})
			.execute();
		expect(await listActiveAccountIds(db)).toContain(idle);
	});
});
