import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createMagicLink, verifyMagicLinkByCode } from "./accounts.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const emails: string[] = [];

function freshEmail(): string {
	const email = `magic-code-${crypto.randomUUID()}@test.invalid`;
	emails.push(email);
	return email;
}

afterAll(async () => {
	if (!HAS_DB) return;
	for (const email of emails) {
		await db.deleteFrom("magic_links").where("email", "=", email).execute();
	}
});

describe.skipIf(!HAS_DB)("verifyMagicLinkByCode", () => {
	test("the right code signs in once", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "123456");
		expect(await verifyMagicLinkByCode(db, email, "123456")).toBe(email);
		expect(await verifyMagicLinkByCode(db, email, "123456")).toBeNull();
	});

	test("a wrong code is refused", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "123456");
		expect(await verifyMagicLinkByCode(db, email, "000000")).toBeNull();
	});

	test("three wrong guesses in a row lock the code, even for the right one", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "123456");
		for (const guess of ["000001", "000002", "000003"]) {
			expect(await verifyMagicLinkByCode(db, email, guess)).toBeNull();
		}
		expect(await verifyMagicLinkByCode(db, email, "123456")).toBeNull();
	});

	test("fifty parallel wrong guesses cannot buy more than three tries", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "123456");
		const guesses = Array.from({ length: 50 }, (_, i) =>
			String(i + 1).padStart(6, "0"),
		);
		const results = await Promise.all(
			guesses.map((guess) => verifyMagicLinkByCode(db, email, guess)),
		);
		expect(results.every((r) => r === null)).toBe(true);

		const { failed_attempts } = await db
			.selectFrom("magic_links")
			.select("failed_attempts")
			.where("email", "=", email)
			.where("code", "=", "123456")
			.executeTakeFirstOrThrow();
		expect(failed_attempts).toBeLessThanOrEqual(3);
		expect(await verifyMagicLinkByCode(db, email, "123456")).toBeNull();
	});

	test("parallel guesses that include the right code still sign in at most once", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "123456");
		const results = await Promise.all(
			["123456", "123456", "123456", "123456"].map((guess) =>
				verifyMagicLinkByCode(db, email, guess),
			),
		);
		expect(results.filter((r) => r === email)).toHaveLength(1);
	});

	test("a newer code voids the older one", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "111111");
		await createMagicLink(db, email, `tok-${crypto.randomUUID()}`, "222222");
		expect(await verifyMagicLinkByCode(db, email, "111111")).toBeNull();
	});
});
