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
import insightsRouter from "./insights.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const tag = `ins${randomUUID().slice(0, 8)}`;

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/api/insights", insightsRouter);
	return a;
}

function detected(
	suffix: string,
	over: Partial<DetectedInsight> = {},
): DetectedInsight {
	return {
		rule: "receiver_down",
		severity: "losing",
		impact: 1,
		resource: {
			kind: "webhook",
			id: `${tag}-${suffix}`,
			name: `hook-${suffix}`,
		},
		line: "line",
		lead: "lead",
		body: "body",
		evidence: [],
		handoff: { prompt: "p", commands: ["sl webhooks doctor x"] },
		how: { detector: "d", facts: [["a", "1"]] },
		...over,
	};
}

async function seed(insights: DetectedInsight[]) {
	await recordEvaluation(
		db,
		{ accountId: null },
		insights,
		insights.map((i) => ({
			kind: i.resource.kind,
			id: i.resource.id,
			rule: i.rule,
		})),
	);
}

async function list(query = "") {
	const res = await app().request(`/api/insights${query}`);
	const body = (await res.json()) as {
		data: {
			id: string;
			resource: { id: string };
			rule: string;
			severity: string;
		}[];
	};
	return { res, body };
}

function mine<T extends { resource: { id: string } }>(rows: T[]): T[] {
	return rows.filter((r) => r.resource.id.startsWith(tag));
}

afterAll(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("insights")
		.where("resource_id", "like", `${tag}%`)
		.execute();
	await db
		.deleteFrom("insight_mutes")
		.where("resource_id", "like", `${tag}%`)
		.execute();
});

describe.skipIf(!HAS_DB)("GET /api/insights", () => {
	test("returns a list that validates against the shared schema, ranked", async () => {
		await seed([
			detected("cost", {
				rule: "test_endpoint",
				severity: "costs",
				impact: 500,
			}),
			detected("lose-small", { impact: 2 }),
			detected("lose-big", { impact: 90 }),
			detected("fail", {
				rule: "tls_expiring",
				severity: "will_fail",
				impact: 1000,
			}),
		]);
		const { res, body } = await list();
		expect(res.status).toBe(200);
		expect(InsightListResponseSchema.safeParse(body).success).toBe(true);
		expect(
			mine(body.data).map((r) => r.resource.id.replace(`${tag}-`, "")),
		).toEqual(["lose-big", "lose-small", "fail", "cost"]);
	});

	test("filters by resource", async () => {
		const { body } = await list(`?resource=webhook:${tag}-fail`);
		expect(body.data.map((r) => r.resource.id)).toEqual([`${tag}-fail`]);
	});

	test("rejects a malformed resource filter", async () => {
		for (const bad of ["webhook", "nope:abc", "webhook:"]) {
			const res = await app().request(
				`/api/insights?resource=${encodeURIComponent(bad)}`,
			);
			expect(res.status, bad).toBe(400);
		}
	});
});

describe.skipIf(!HAS_DB)("insight actions", () => {
	function post(path: string, method = "POST") {
		return app().request(`/api/insights/${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
		});
	}

	test("dismiss hides the insight", async () => {
		await seed([detected("dismiss")]);
		const row = mine((await list()).body.data).find(
			(r) => r.resource.id === `${tag}-dismiss`,
		);
		const res = await post(`${row?.id}/dismiss`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(
			mine((await list()).body.data).some(
				(r) => r.resource.id === `${tag}-dismiss`,
			),
		).toBe(false);
	});

	test("expected mutes the rule, and un-expecting brings it back", async () => {
		await seed([detected("mute")]);
		const row = mine((await list()).body.data).find(
			(r) => r.resource.id === `${tag}-mute`,
		);
		expect((await post(`${row?.id}/expected`)).status).toBe(200);
		expect(
			mine((await list()).body.data).some(
				(r) => r.resource.id === `${tag}-mute`,
			),
		).toBe(false);

		const again = await post(`${row?.id}/expected`, "DELETE");
		expect(again.status).toBe(200);
		expect(
			mine((await list()).body.data).some(
				(r) => r.resource.id === `${tag}-mute`,
			),
		).toBe(true);
	});

	test("unknown and malformed ids are 404", async () => {
		for (const id of [randomUUID(), "not-a-uuid"]) {
			for (const [suffix, method] of [
				["dismiss", "POST"],
				["expected", "POST"],
				["expected", "DELETE"],
			] as const) {
				const res = await post(`${id}/${suffix}`, method);
				expect(res.status, `${method} ${id}/${suffix}`).toBe(404);
				expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND");
			}
		}
	});

	test("does not touch another account's rows", async () => {
		const other = randomUUID();
		await recordEvaluation(
			db,
			{ accountId: other },
			[detected("foreign")],
			[{ kind: "webhook", id: `${tag}-foreign`, rule: "receiver_down" }],
		);
		try {
			const row = await db
				.selectFrom("insights")
				.select("id")
				.where("account_id", "=", other)
				.executeTakeFirstOrThrow();
			expect((await post(`${row.id}/dismiss`)).status).toBe(404);
			expect(
				mine((await list()).body.data).some(
					(r) => r.resource.id === `${tag}-foreign`,
				),
			).toBe(false);
		} finally {
			await db.deleteFrom("insights").where("account_id", "=", other).execute();
		}
	});
});
