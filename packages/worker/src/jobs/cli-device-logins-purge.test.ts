import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { purgeExpiredCliDeviceLogins } from "./cli-device-logins-purge.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const ids: string[] = [];

afterAll(async () => {
	if (!HAS_DB || ids.length === 0) return;
	await db.deleteFrom("cli_device_logins").where("id", "in", ids).execute();
});

describe.skipIf(!HAS_DB)("purgeExpiredCliDeviceLogins", () => {
	test("deletes an attempt that expired 2 days ago and keeps one that expired an hour ago", async () => {
		const tag = crypto.randomUUID().slice(0, 8);
		const row = (suffix: string, expiresAgoMs: number) => ({
			device_code_hash: `purge-test-${tag}-${suffix}`,
			user_code: `T${tag.slice(0, 3).toUpperCase()}-${suffix}`,
			client_name: "purge-test",
			expires_at: new Date(Date.now() - expiresAgoMs),
		});
		const inserted = await db
			.insertInto("cli_device_logins")
			.values([row("OLD", 2 * 24 * 60 * 60_000), row("NEW", 60 * 60_000)])
			.returning(["id", "client_name", "device_code_hash"])
			.execute();
		ids.push(...inserted.map((r) => r.id));

		await purgeExpiredCliDeviceLogins();

		const left = await db
			.selectFrom("cli_device_logins")
			.select("device_code_hash")
			.where("id", "in", ids)
			.execute();
		expect(left.map((r) => r.device_code_hash)).toEqual([
			`purge-test-${tag}-NEW`,
		]);
	});
});
