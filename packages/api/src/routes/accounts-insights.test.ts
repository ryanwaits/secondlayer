import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	type DetectedInsight,
	recordEvaluation,
} from "@secondlayer/shared/insights";
import { InsightListResponseSchema } from "@secondlayer/shared/schemas/insights";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import accountsRouter from "./accounts.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountA = randomUUID();
const accountB = randomUUID();

/** Stands in for the auth middleware: the account comes from a test header. */
function app() {
	const a = new Hono<{ Variables: { accountId: string } }>();
	a.onError(errorHandler);
	a.use("*", async (c, next) => {
		const id = c.req.header("x-test-account");
		if (id) c.set("accountId", id);
		await next();
	});
	a.route("/api/accounts", accountsRouter);
	return a;
}

function detected(
	rule: string,
	severity: DetectedInsight["severity"],
	impact: number,
): DetectedInsight {
	return {
		rule,
		severity,
		impact,
		resource: { kind: "account", id: "account", name: "Account" },
		line: "line",
		lead: "lead",
		body: "body",
		evidence: [],
		handoff: { prompt: "p", commands: [] },
		how: { detector: "d", facts: [] },
	};
}

async function seed(accountId: string, insights: DetectedInsight[]) {
	await recordEvaluation(
		db,
		{ accountId },
		insights,
		insights.map((i) => ({
			kind: i.resource.kind,
			id: i.resource.id,
			rule: i.rule,
		})),
	);
}

function request(account: string | null, path: string, method = "GET") {
	return app().request(`/api/accounts/insights${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(account ? { "x-test-account": account } : {}),
		},
	});
}

afterAll(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("insights")
		.where("account_id", "in", [accountA, accountB])
		.execute();
	await db
		.deleteFrom("insight_mutes")
		.where("account_id", "in", [accountA, accountB])
		.execute();
});

describe.skipIf(!HAS_DB)("/api/accounts/insights", () => {
	test("lists the signed-in account's insights, ranked, in the shared shape", async () => {
		await seed(accountA, [
			detected("allowance_exhausted", "costs", 4),
			detected("server_errors", "losing", 9),
			detected("cap_pace", "will_fail", 1),
		]);
		const res = await request(accountA, "");
		expect(res.status).toBe(200);
		const body = await res.json();
		const parsed = InsightListResponseSchema.safeParse(body);
		expect(parsed.success).toBe(true);
		expect(parsed.data?.data.map((i) => i.rule)).toEqual([
			"server_errors",
			"cap_pace",
			"allowance_exhausted",
		]);
	});

	test("one account never sees another's insights", async () => {
		await seed(accountB, [detected("backfill", "costs", 1)]);
		const a = (await (await request(accountA, "")).json()) as {
			data: { rule: string }[];
		};
		const b = (await (await request(accountB, "")).json()) as {
			data: { rule: string }[];
		};
		expect(a.data.map((i) => i.rule)).not.toContain("backfill");
		expect(b.data.map((i) => i.rule)).toEqual(["backfill"]);
	});

	test("an unauthenticated request is refused", async () => {
		expect((await request(null, "")).status).toBe(401);
	});

	test("dismiss, expected and un-expected work on your own rows only", async () => {
		const own = (await (await request(accountA, "")).json()) as {
			data: { id: string; rule: string }[];
		};
		const target = own.data.find((i) => i.rule === "cap_pace");
		const foreign = (await (await request(accountB, "")).json()) as {
			data: { id: string }[];
		};

		// Account B cannot touch account A's row.
		expect(
			(await request(accountB, `/${target?.id}/dismiss`, "POST")).status,
		).toBe(404);

		expect(
			(await request(accountA, `/${target?.id}/expected`, "POST")).status,
		).toBe(200);
		let after = (await (await request(accountA, "")).json()) as {
			data: { rule: string }[];
		};
		expect(after.data.map((i) => i.rule)).not.toContain("cap_pace");

		expect(
			(await request(accountA, `/${target?.id}/expected`, "DELETE")).status,
		).toBe(200);
		after = (await (await request(accountA, "")).json()) as {
			data: { rule: string }[];
		};
		expect(after.data.map((i) => i.rule)).toContain("cap_pace");

		expect(
			(await request(accountA, `/${target?.id}/dismiss`, "POST")).status,
		).toBe(200);
		after = (await (await request(accountA, "")).json()) as {
			data: { rule: string }[];
		};
		expect(after.data.map((i) => i.rule)).not.toContain("cap_pace");

		// Account B's row is untouched by all of it.
		const stillThere = (await (await request(accountB, "")).json()) as {
			data: { id: string }[];
		};
		expect(stillThere.data.map((i) => i.id)).toEqual(
			foreign.data.map((i) => i.id),
		);
	});

	test("an unknown id is 404", async () => {
		expect(
			(await request(accountA, `/${randomUUID()}/dismiss`, "POST")).status,
		).toBe(404);
	});
});
