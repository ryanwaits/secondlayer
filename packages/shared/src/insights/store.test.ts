import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.ts";
import {
	dismissInsight,
	listInsights,
	muteRule,
	purgeResolved,
	recordEvaluation,
	snoozeInsight,
	undismissInsight,
	unmuteRule,
	unsnoozeInsight,
} from "./store.ts";
import type { DetectedInsight } from "./types.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const tag = randomUUID().slice(0, 8);
const accountA = randomUUID();
const accountB = randomUUID();
const NULL_SCOPE = { accountId: null };
const SCOPE_A = { accountId: accountA };
const SCOPE_B = { accountId: accountB };

function detected(
	over: Partial<DetectedInsight> & { resourceId?: string } = {},
): DetectedInsight {
	const { resourceId, ...rest } = over;
	return {
		rule: "receiver_down",
		severity: "losing",
		impact: 10,
		resource: {
			kind: "webhook",
			id: resourceId ?? `${tag}-wh`,
			name: "mint-alerts",
		},
		line: "Receiver is down",
		lead: "Lead.",
		body: "Body.",
		evidence: [],
		handoff: { prompt: "Check it.", commands: ["sl webhooks doctor x"] },
		how: { detector: "d", facts: [["a", "1"]] },
		...rest,
	};
}

function key(resourceId = `${tag}-wh`, rule = "receiver_down") {
	return { kind: "webhook" as const, id: resourceId, rule };
}

afterAll(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("insights")
		.where((eb) =>
			eb.or([
				eb("account_id", "in", [accountA, accountB]),
				eb("resource_id", "like", `${tag}%`),
			]),
		)
		.execute();
	await db
		.deleteFrom("insight_mutes")
		.where((eb) =>
			eb.or([
				eb("account_id", "in", [accountA, accountB]),
				eb("resource_id", "like", `${tag}%`),
			]),
		)
		.execute();
});

async function ours(scope: { accountId: string | null }, now?: Date) {
	const all = await listInsights(db, scope, now);
	return all.filter((i) => i.resource.id.startsWith(tag));
}

describe.skipIf(!HAS_DB)("insight store", () => {
	test("a repeated fire keeps one open row and refreshes the payload", async () => {
		const id = `${tag}-upsert`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id, line: "Updated line", impact: 99 })],
			[key(id)],
		);
		const rows = (await ours(NULL_SCOPE)).filter((i) => i.resource.id === id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.line).toBe("Updated line");
		expect(rows[0]?.impact).toBe(99);
		expect(rows[0]?.severity).toBe("losing");
	});

	test("one clean pass keeps it open, two resolve it", async () => {
		const id = `${tag}-clear`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		let row = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(row?.severity).toBe("losing");
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		row = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(row?.severity).toBe("recovered");
		expect(row?.resolvedAt).toBeTruthy();
	});

	test("a fire between clean passes resets the streak", async () => {
		const id = `${tag}-reset`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		const row = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(row?.severity).toBe("losing");
	});

	test("a skipped rule never counts toward clearing", async () => {
		const id = `${tag}-skip`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		for (let i = 0; i < 5; i++) {
			await recordEvaluation(db, NULL_SCOPE, [], []);
		}
		const row = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(row?.severity).toBe("losing");
	});

	test("a resolved row lists as recovered for 24h, then disappears", async () => {
		const id = `${tag}-recovered`;
		const resolvedAt = new Date("2026-10-15T00:00:00.000Z");
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
			resolvedAt,
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)], resolvedAt);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)], resolvedAt);

		const within = await ours(
			NULL_SCOPE,
			new Date(resolvedAt.getTime() + 23 * 3600_000),
		);
		expect(within.find((i) => i.resource.id === id)?.severity).toBe(
			"recovered",
		);
		const after = await ours(
			NULL_SCOPE,
			new Date(resolvedAt.getTime() + 25 * 3600_000),
		);
		expect(after.find((i) => i.resource.id === id)).toBeUndefined();
	});

	test("a new incident after resolution lists once, as the open row", async () => {
		const id = `${tag}-again`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		const rows = (await ours(NULL_SCOPE)).filter((i) => i.resource.id === id);
		expect(rows.map((r) => r.severity)).toEqual(["losing"]);
	});

	test("two recovered incidents of one rule list once, the latest", async () => {
		const id = `${tag}-twice`;
		const first = new Date("2026-10-16T20:00:00.000Z");
		const second = new Date("2026-10-17T09:00:00.000Z");
		for (const [at, line] of [
			[first, "First"],
			[second, "Second"],
		] as const) {
			await recordEvaluation(
				db,
				NULL_SCOPE,
				[detected({ resourceId: id, line })],
				[key(id)],
				at,
			);
			await recordEvaluation(db, NULL_SCOPE, [], [key(id)], at);
			await recordEvaluation(db, NULL_SCOPE, [], [key(id)], at);
		}
		const rows = (
			await ours(NULL_SCOPE, new Date(second.getTime() + 3600_000))
		).filter((i) => i.resource.id === id);
		expect(rows.map((r) => [r.severity, r.line])).toEqual([
			["recovered", "Second"],
		]);
	});

	test("dismissing the latest incident never surfaces an older one", async () => {
		const id = `${tag}-dismiss-latest`;
		const at = new Date("2026-10-16T20:00:00.000Z");
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
			at,
		);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)], at);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)], at);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
			at,
		);
		const later = new Date(at.getTime() + 3600_000);
		const open = (await ours(NULL_SCOPE, later)).find(
			(i) => i.resource.id === id,
		);
		expect(open?.severity).toBe("losing");
		await dismissInsight(db, NULL_SCOPE, open?.id ?? "", later);
		const rows = (await ours(NULL_SCOPE, later)).filter(
			(i) => i.resource.id === id,
		);
		expect(rows).toEqual([]);
	});

	test("dismissed insights are hidden", async () => {
		const id = `${tag}-dismiss`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		const row = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(row).toBeDefined();
		expect(await dismissInsight(db, NULL_SCOPE, row?.id ?? "")).toBe(true);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();
	});

	test("muted rules stay hidden for later incidents until un-muted", async () => {
		const id = `${tag}-mute`;
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		const first = (await ours(NULL_SCOPE)).find((i) => i.resource.id === id);
		expect(await muteRule(db, NULL_SCOPE, first?.id ?? "")).toBe(true);
		// Muting twice is fine.
		expect(await muteRule(db, NULL_SCOPE, first?.id ?? "")).toBe(true);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();

		// Resolve, then a later incident of the same rule is still hidden.
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		await recordEvaluation(db, NULL_SCOPE, [], [key(id)]);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id })],
			[key(id)],
		);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();

		expect(await unmuteRule(db, NULL_SCOPE, first?.id ?? "")).toBe(true);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeDefined();
	});

	async function seedOne(
		id: string,
		scope: { accountId: string | null } = NULL_SCOPE,
	) {
		await recordEvaluation(
			db,
			scope,
			[detected({ resourceId: id })],
			[key(id)],
		);
		const row = (await ours(scope)).find((i) => i.resource.id === id);
		return row?.id ?? "";
	}

	test("a snoozed insight is hidden until its time, then shows again", async () => {
		const id = `${tag}-snooze`;
		const rowId = await seedOne(id);
		const now = new Date();
		const hour = 60 * 60 * 1000;
		expect(
			await snoozeInsight(
				db,
				NULL_SCOPE,
				rowId,
				new Date(now.getTime() + hour),
			),
		).toBe(true);
		const hidden = await ours(NULL_SCOPE, now);
		expect(hidden.find((i) => i.resource.id === id)).toBeUndefined();
		const later = await ours(NULL_SCOPE, new Date(now.getTime() + 2 * hour));
		expect(later.find((i) => i.resource.id === id)).toBeDefined();
	});

	test("a re-fire keeps the snooze", async () => {
		const id = `${tag}-snooze-refire`;
		const rowId = await seedOne(id);
		const until = new Date(Date.now() + 60 * 60 * 1000);
		await snoozeInsight(db, NULL_SCOPE, rowId, until);
		await recordEvaluation(
			db,
			NULL_SCOPE,
			[detected({ resourceId: id, line: "Fired again" })],
			[key(id)],
		);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();
	});

	test("unsnooze shows it now", async () => {
		const id = `${tag}-unsnooze`;
		const rowId = await seedOne(id);
		await snoozeInsight(db, NULL_SCOPE, rowId, new Date(Date.now() + 3600_000));
		expect(await unsnoozeInsight(db, NULL_SCOPE, rowId)).toBe(true);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeDefined();
	});

	test("undismiss shows a dismissed insight again", async () => {
		const id = `${tag}-undismiss`;
		const rowId = await seedOne(id);
		await dismissInsight(db, NULL_SCOPE, rowId);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();
		expect(await undismissInsight(db, NULL_SCOPE, rowId)).toBe(true);
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeDefined();
	});

	test("snooze is scoped", async () => {
		const rowId = await seedOne(`${tag}-snooze-scope`, SCOPE_A);
		expect(
			await snoozeInsight(db, SCOPE_B, rowId, new Date(Date.now() + 3600_000)),
		).toBe(false);
		expect(await unsnoozeInsight(db, SCOPE_B, rowId)).toBe(false);
		expect(await undismissInsight(db, SCOPE_B, rowId)).toBe(false);
	});

	test("unknown or malformed ids report false", async () => {
		expect(await dismissInsight(db, NULL_SCOPE, randomUUID())).toBe(false);
		expect(await muteRule(db, NULL_SCOPE, randomUUID())).toBe(false);
		expect(await unmuteRule(db, NULL_SCOPE, "not-a-uuid")).toBe(false);
	});

	test("account scopes never leak into each other or the NULL scope", async () => {
		const id = `${tag}-scope`;
		await recordEvaluation(
			db,
			SCOPE_A,
			[detected({ resourceId: id })],
			[key(id)],
		);
		await recordEvaluation(
			db,
			SCOPE_B,
			[detected({ resourceId: id, line: "B's" })],
			[key(id)],
		);

		const a = await ours(SCOPE_A);
		const b = await ours(SCOPE_B);
		expect(a.filter((i) => i.resource.id === id)).toHaveLength(1);
		expect(b.filter((i) => i.resource.id === id)).toHaveLength(1);
		expect(b.find((i) => i.resource.id === id)?.line).toBe("B's");
		expect(
			(await ours(NULL_SCOPE)).find((i) => i.resource.id === id),
		).toBeUndefined();

		const aRow = a.find((i) => i.resource.id === id);
		expect(await dismissInsight(db, SCOPE_B, aRow?.id ?? "")).toBe(false);
		expect(await muteRule(db, NULL_SCOPE, aRow?.id ?? "")).toBe(false);
		expect(
			(await ours(SCOPE_A)).find((i) => i.resource.id === id),
		).toBeDefined();

		// A clean pass in B does not resolve A's row.
		await recordEvaluation(db, SCOPE_B, [], [key(id)]);
		await recordEvaluation(db, SCOPE_B, [], [key(id)]);
		expect(
			(await ours(SCOPE_A)).find((i) => i.resource.id === id)?.severity,
		).toBe("losing");
	});

	test("purge removes old resolved rows only", async () => {
		const id = `${tag}-purge`;
		const old = new Date("2026-08-01T00:00:00.000Z");
		await recordEvaluation(
			db,
			SCOPE_A,
			[detected({ resourceId: id })],
			[key(id)],
			old,
		);
		await recordEvaluation(db, SCOPE_A, [], [key(id)], old);
		await recordEvaluation(db, SCOPE_A, [], [key(id)], old);
		await purgeResolved(db, SCOPE_A, 30, new Date("2026-10-15T00:00:00.000Z"));
		const left = await db
			.selectFrom("insights")
			.select("id")
			.where("resource_id", "=", id)
			.execute();
		expect(left).toHaveLength(0);
	});
});
