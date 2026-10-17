import { describe, expect, test } from "bun:test";
import { authFailureMessage } from "./api-client.ts";

describe("authFailureMessage", () => {
	test("a revoked key says the login was revoked", () => {
		const out = authFailureMessage("KEY_REVOKED", 401, false);
		expect(out?.message).toBe("Your saved login was revoked.");
		expect(out?.hint).toContain("secondlayer login");
	});

	test("a plain 401 asks to authenticate", () => {
		expect(authFailureMessage(undefined, 401, false)?.message).toBe(
			"Authentication required.",
		);
	});

	test("an expired session asks to authenticate", () => {
		expect(
			authFailureMessage("SESSION_EXPIRED", undefined, false)?.message,
		).toBe("Authentication required.");
	});

	test("self-host points at the instance token", () => {
		expect(authFailureMessage(undefined, 401, true)?.hint).toContain(
			"INSTANCE_TOKEN",
		);
	});

	test("non-auth failures are not claimed", () => {
		expect(authFailureMessage("NOT_FOUND", 404, false)).toBeNull();
	});
});
