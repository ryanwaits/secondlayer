import { afterEach, describe, expect, test } from "bun:test";
import { secretsKeyAvailable } from "./secrets.ts";

/**
 * Plan f072: `secretsKeyAvailable()` is the non-throwing predicate the
 * subgraph processor uses to decide, BEFORE attempting a decrypt, whether a
 * BYO route can be resolved at all. It must never throw and never leak the
 * key — only report true/false.
 */

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const MODE_ENV = "INSTANCE_MODE";
const originalKey = process.env[KEY_ENV];
const originalMode = process.env[MODE_ENV];

afterEach(() => {
	if (originalKey === undefined) delete process.env[KEY_ENV];
	else process.env[KEY_ENV] = originalKey;
	if (originalMode === undefined) delete process.env[MODE_ENV];
	else process.env[MODE_ENV] = originalMode;
});

describe("secretsKeyAvailable", () => {
	test("true when a key is set in the environment", () => {
		process.env[KEY_ENV] = "a".repeat(64);
		expect(secretsKeyAvailable()).toBe(true);
	});

	test("false in platform mode with the env var unset (no OSS file fallback applies)", () => {
		delete process.env[KEY_ENV];
		process.env[MODE_ENV] = "platform";
		expect(secretsKeyAvailable()).toBe(false);
	});

	test("never throws, whether the key is set or unset", () => {
		delete process.env[KEY_ENV];
		process.env[MODE_ENV] = "platform";
		expect(() => secretsKeyAvailable()).not.toThrow();

		process.env[KEY_ENV] = "b".repeat(64);
		expect(() => secretsKeyAvailable()).not.toThrow();
	});
});
