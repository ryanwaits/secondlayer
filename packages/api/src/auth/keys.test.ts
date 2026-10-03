import { expect, test } from "bun:test";
import { SENTINEL_KEY_PREFIX, generateApiKey, hashToken } from "./keys.ts";

test("generated key has correct prefix format", () => {
	const { raw, prefix } = generateApiKey();
	expect(raw).toMatch(/^sk-sl_[0-9a-f]{32}$/);
	expect(prefix).toMatch(/^sk-sl_[0-9a-f]{8}$/);
	expect(raw.startsWith(prefix)).toBe(true);
});

test("a sentinel key carries its own prefix", () => {
	const { raw, prefix, hash } = generateApiKey(SENTINEL_KEY_PREFIX);
	expect(raw).toMatch(/^sk-snt_[0-9a-f]{32}$/);
	expect(prefix).toMatch(/^sk-snt_[0-9a-f]{8}$/);
	expect(hashToken(raw)).toBe(hash);
});

test("hash is deterministic", () => {
	const { raw, hash } = generateApiKey();
	expect(hashToken(raw)).toBe(hash);
});

test("1000 keys are unique", () => {
	const keys = new Set<string>();
	for (let i = 0; i < 1000; i++) {
		keys.add(generateApiKey().raw);
	}
	expect(keys.size).toBe(1000);
});
