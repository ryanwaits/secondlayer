import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readApiKey } from "./client.ts";

describe("MCP credential resolution", () => {
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
	});

	it("reads INSTANCE_TOKEN on its own", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(readApiKey()).toBe("token-from-init");
	});

	it("still reads the legacy SL_API_KEY alias on its own", () => {
		process.env.SL_API_KEY = "legacy-key";
		expect(readApiKey()).toBe("legacy-key");
	});

	it("prefers INSTANCE_TOKEN when both are set", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		process.env.SL_API_KEY = "legacy-key";
		expect(readApiKey()).toBe("token-from-init");
	});

	it("treats an empty value as unset", () => {
		process.env.INSTANCE_TOKEN = "";
		expect(readApiKey()).toBeUndefined();
		process.env.SL_API_KEY = "";
		expect(readApiKey()).toBeUndefined();
	});
});
