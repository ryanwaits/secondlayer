import { describe, expect, test } from "bun:test";
import { groupRevokedCalls } from "./load.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 20, minute));

function row(keyId: string, path: string, minute: number) {
	return {
		key_id: keyId,
		path,
		created_at: at(minute),
		name: keyId === "k1" ? "sharko-barko" : null,
		key_prefix: `sk-sl_${keyId}`,
		revoked_at: at(0),
	};
}

describe("groupRevokedCalls", () => {
	test("one entry per key, most-called first, with its top paths", () => {
		const out = groupRevokedCalls([
			row("k1", "/v1/index/transactions", 1),
			row("k1", "/v1/index/transactions", 5),
			row("k1", "/v1/streams/events", 3),
			row("k2", "/v1/index/blocks", 2),
		]);
		expect(out.map((k) => [k.keyId, k.calls])).toEqual([
			["k1", 3],
			["k2", 1],
		]);
		expect(out[0]?.lastAt).toEqual(at(5));
		expect(out[0]?.topPaths[0]).toEqual({
			path: "/v1/index/transactions",
			calls: 2,
		});
		expect(out[1]?.name).toBe("sk-sl_k2");
	});

	test("a login check with a revoked key is not the key being in use", () => {
		expect(groupRevokedCalls([row("k2", "/api/accounts/me", 59)])).toEqual([]);
		const out = groupRevokedCalls([
			row("k1", "/api/accounts/me", 59),
			row("k1", "/v1/index/ft-transfers", 41),
		]);
		expect(out.map((k) => [k.keyId, k.calls])).toEqual([["k1", 1]]);
	});
});
