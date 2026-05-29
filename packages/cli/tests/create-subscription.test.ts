import { describe, expect, it } from "bun:test";
import { buildSubscriptionAuthConfig } from "../src/commands/create.ts";

describe("create subscription tenant resolution", () => {
	it("builds bearer auth config from --auth-token", () => {
		expect(buildSubscriptionAuthConfig(" tr_secret_abc ")).toEqual({
			authType: "bearer",
			token: "tr_secret_abc",
		});
		expect(buildSubscriptionAuthConfig()).toBeUndefined();
		expect(() => buildSubscriptionAuthConfig("   ")).toThrow(
			"--auth-token must not be empty",
		);
	});
});
