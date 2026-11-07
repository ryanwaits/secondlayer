import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { purgeExpiredAuthRecords } from "./auth-records-purge.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const DAY = 24 * 60 * 60_000;
let accountId: string | null = null;
const emails: string[] = [];

afterAll(async () => {
	if (!HAS_DB) return;
	if (emails.length > 0) {
		await db.deleteFrom("magic_links").where("email", "in", emails).execute();
	}
	if (accountId) {
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
	}
});

describe.skipIf(!HAS_DB)("purgeExpiredAuthRecords", () => {
	test("deletes sessions and magic links expired over 30 days ago and keeps newer ones", async () => {
		const tag = crypto.randomUUID().slice(0, 8);
		const account = await db
			.insertInto("accounts")
			.values({ email: `purge-${tag}@example.com` })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = account.id;
		const session = (suffix: string, expiredAgoMs: number) => ({
			token_hash: `purge-${tag}-${suffix}`,
			token_prefix: "ss-sl_purge",
			account_id: account.id,
			ip_address: "test",
			expires_at: new Date(Date.now() - expiredAgoMs),
		});
		await db
			.insertInto("sessions")
			.values([session("old", 31 * DAY), session("new", 29 * DAY)])
			.execute();
		const link = (suffix: string, expiredAgoMs: number) => {
			const email = `purge-link-${tag}-${suffix}@example.com`;
			emails.push(email);
			return {
				email,
				token: `purge-${tag}-${suffix}`,
				code: "000000",
				expires_at: new Date(Date.now() - expiredAgoMs),
			};
		};
		await db
			.insertInto("magic_links")
			.values([link("old", 31 * DAY), link("new", 29 * DAY)])
			.execute();

		const purged = await purgeExpiredAuthRecords();
		expect(purged.sessions).toBeGreaterThanOrEqual(1);
		expect(purged.magicLinks).toBeGreaterThanOrEqual(1);

		const sessions = await db
			.selectFrom("sessions")
			.select("token_hash")
			.where("account_id", "=", account.id)
			.execute();
		expect(sessions.map((r) => r.token_hash)).toEqual([`purge-${tag}-new`]);
		const links = await db
			.selectFrom("magic_links")
			.select("token")
			.where("email", "in", emails)
			.execute();
		expect(links.map((r) => r.token)).toEqual([`purge-${tag}-new`]);
	});
});
