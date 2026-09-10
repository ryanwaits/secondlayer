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
	const originalAccount = process.env.SECONDLAYER_API_KEY;

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
		if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
		else process.env.SECONDLAYER_API_KEY = originalAccount;
	});

	it("reads INSTANCE_TOKEN on its own", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(readApiKey()).toBe("token-from-init");
	});

	it("ignores SL_API_KEY (hosted account key, not instance)", () => {
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(readApiKey()).toBeUndefined();
	});

	it("prefers INSTANCE_TOKEN; SL_API_KEY does not override", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		process.env.SL_API_KEY = "sk-sl_legacy";
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
	const originalLegacy = process.env.SL_API_KEY;
	const originalAccount = process.env.SECONDLAYER_API_KEY;

	beforeEach(() => {
		delete process.env.SL_ARCHIVE_API_KEY;
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
	});

	afterEach(() => {
		if (originalArchiveKey === undefined) delete process.env.SL_ARCHIVE_API_KEY;
		else process.env.SL_ARCHIVE_API_KEY = originalArchiveKey;
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
		if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
		else process.env.SECONDLAYER_API_KEY = originalAccount;
	});

	it("does not treat INSTANCE_TOKEN as the hosted bearer", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		expect(readArchiveApiKey()).toBeUndefined();
		expect(() => getArchiveOpsClient()).toThrow(HOSTED_KEY_HINT);
	});

	it("reads SECONDLAYER_API_KEY", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		process.env.SECONDLAYER_API_KEY = "sk-sl_primary";
		expect(readArchiveApiKey()).toBe("sk-sl_primary");
	});

	it("falls back to SL_API_KEY when primary unset", () => {
		process.env.SL_API_KEY = "sk-sl_alias";
		expect(readArchiveApiKey()).toBe("sk-sl_alias");
	});

	it("falls back to SL_ARCHIVE_API_KEY when others unset", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		process.env.SL_ARCHIVE_API_KEY = "sk-sl_credits";
		expect(readArchiveApiKey()).toBe("sk-sl_credits");
	});

	it("getArchiveOpsClient constructs with accountKey", () => {
		process.env.SECONDLAYER_API_KEY = "sk-sl_primary";
		const client = getArchiveOpsClient();
		expect(client).toBeDefined();
	});
});
