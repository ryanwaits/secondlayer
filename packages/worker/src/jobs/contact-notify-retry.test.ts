import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { retryUnnotifiedContacts } from "./contact-notify-retry.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const ids: string[] = [];

afterAll(async () => {
	if (!HAS_DB || ids.length === 0) return;
	await db.deleteFrom("contact_requests").where("id", "in", ids).execute();
});

describe.skipIf(!HAS_DB)("retryUnnotifiedContacts", () => {
	test("notifies an old unnotified request once and leaves fresh, notified and cold ones alone", async () => {
		const tag = crypto.randomUUID().slice(0, 8);
		const ago = (ms: number) => new Date(Date.now() - ms);
		const row = (suffix: string, createdAgo: number, notified = false) => ({
			name: `Retry ${suffix}`,
			email: `retry-${tag}-${suffix}@example.com`,
			message: `retry test ${tag} ${suffix}`,
			created_at: ago(createdAgo),
			notified_at: notified ? new Date() : null,
		});
		const inserted = await db
			.insertInto("contact_requests")
			.values([
				row("due", 60 * 60_000),
				row("fresh", 30_000),
				row("done", 60 * 60_000, true),
				row("cold", 8 * 24 * 60 * 60_000),
			])
			.returning(["id", "email"])
			.execute();
		ids.push(...inserted.map((r) => r.id));
		const mine = new Map(inserted.map((r) => [r.id, r.email]));

		const notified: string[] = [];
		const sent = await retryUnnotifiedContacts(new Date(), async (id) => {
			const email = mine.get(id);
			if (email) notified.push(email);
			return true;
		});
		expect(sent).toBeGreaterThanOrEqual(1);
		expect(notified).toEqual([`retry-${tag}-due@example.com`]);

		const due = inserted.find((r) => r.email.includes("-due@"));
		const after = await db
			.selectFrom("contact_requests")
			.select("notified_at")
			.where("id", "=", due?.id as string)
			.executeTakeFirstOrThrow();
		expect(after.notified_at).not.toBeNull();

		// Already notified: a second pass sends nothing for it.
		const again: string[] = [];
		await retryUnnotifiedContacts(new Date(), async (id) => {
			if (mine.has(id)) again.push(id);
			return true;
		});
		expect(again).toEqual([]);
	});

	test("a failed notification stays unnotified for the next pass", async () => {
		const tag = crypto.randomUUID().slice(0, 8);
		const inserted = await db
			.insertInto("contact_requests")
			.values({
				name: "Retry fail",
				email: `retry-fail-${tag}@example.com`,
				message: `retry fail ${tag}`,
				created_at: new Date(Date.now() - 60 * 60_000),
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		ids.push(inserted.id);
		await retryUnnotifiedContacts(new Date(), async () => false);
		const row = await db
			.selectFrom("contact_requests")
			.select("notified_at")
			.where("id", "=", inserted.id)
			.executeTakeFirstOrThrow();
		expect(row.notified_at).toBeNull();
	});
});
