import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveArchiveOpsBearer } from "./http.ts";

describe("resolveArchiveOpsBearer", () => {
	const originals = {
		INSTANCE_TOKEN: process.env.INSTANCE_TOKEN,
		SECONDLAYER_API_KEY: process.env.SECONDLAYER_API_KEY,
		SL_API_KEY: process.env.SL_API_KEY,
		SL_ARCHIVE_API_KEY: process.env.SL_ARCHIVE_API_KEY,
		HOME: process.env.HOME,
	};

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SECONDLAYER_API_KEY;
		delete process.env.SL_API_KEY;
		delete process.env.SL_ARCHIVE_API_KEY;
		// Isolate session store so leftover logins do not mask env resolution.
		process.env.HOME = `/tmp/sl-archive-bearer-${process.pid}`;
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(originals)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	test("hex INSTANCE_TOKEN alone yields no archive bearer and ignoredEnvKey", async () => {
		process.env.INSTANCE_TOKEN = "a".repeat(64);
		const result = await resolveArchiveOpsBearer();
		expect(result.bearer).toBeUndefined();
		expect(result.source).toBeNull();
		expect(result.ignoredEnvKey).toBe(true);
	});

	test("SECONDLAYER_API_KEY=sk-sl_* yields env bearer", async () => {
		process.env.SECONDLAYER_API_KEY = "sk-sl_credits";
		const result = await resolveArchiveOpsBearer();
		expect(result.bearer).toBe("sk-sl_credits");
		expect(result.source).toBe("env");
		expect(result.ignoredEnvKey).toBe(false);
	});
});
