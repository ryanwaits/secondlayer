import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	HOSTED_KEY_HINT,
	getArchiveOpsClient,
	readApiKey,
	readArchiveApiKey,
} from "./client.ts";

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

describe("hosted archive ops credentials", () => {
	const originalArchiveKey = process.env.SL_ARCHIVE_API_KEY;
	const originalToken = process.env.INSTANCE_TOKEN;

	beforeEach(() => {
		delete process.env.SL_ARCHIVE_API_KEY;
		delete process.env.INSTANCE_TOKEN;
	});

	afterEach(() => {
		if (originalArchiveKey === undefined) delete process.env.SL_ARCHIVE_API_KEY;
		else process.env.SL_ARCHIVE_API_KEY = originalArchiveKey;
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
	});

	it("does not treat INSTANCE_TOKEN as the hosted bearer", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		expect(readArchiveApiKey()).toBeUndefined();
		expect(() => getArchiveOpsClient()).toThrow(HOSTED_KEY_HINT);
	});

	it("reads SL_ARCHIVE_API_KEY only", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		process.env.SL_ARCHIVE_API_KEY = "sk-sl_credits";
		expect(readArchiveApiKey()).toBe("sk-sl_credits");
	});
});
