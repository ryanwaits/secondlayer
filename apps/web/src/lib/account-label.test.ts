import { describe, expect, test } from "bun:test";
import { accountLabel } from "./account-label";

describe("accountLabel", () => {
	test("is the email when there is one", () => {
		expect(accountLabel({ id: "a1", email: "a@b.co" })).toBe("a@b.co");
	});

	test("is the id for an account with no email", () => {
		expect(accountLabel({ id: "a1", email: null })).toBe("a1");
	});
});
