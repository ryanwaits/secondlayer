import { describe, expect, test } from "bun:test";
import { InProcNonceStore, RedisNonceStore } from "../nonce-store.ts";

describe("InProcNonceStore", () => {
	test("a key consumes exactly once; replay is rejected", async () => {
		const store = new InProcNonceStore();
		expect(await store.consume("nonce:a", 60_000)).toBe(true);
		expect(await store.consume("nonce:a", 60_000)).toBe(false);
		expect(await store.consume("nonce:b", 60_000)).toBe(true);
	});

	test("a key is reusable after its ttl elapses", async () => {
		const store = new InProcNonceStore();
		expect(await store.consume("txid:x", 1)).toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(await store.consume("txid:x", 1)).toBe(true);
	});
});

describe("RedisNonceStore fail-closed", () => {
	test("an unreachable Redis rejects (does NOT let a payment through)", async () => {
		// Port 1 refuses immediately; the 250ms timeout also bounds it.
		const store = new RedisNonceStore("redis://127.0.0.1:1");
		expect(await store.consume("nonce:unreachable", 60_000)).toBe(false);
	});
});
