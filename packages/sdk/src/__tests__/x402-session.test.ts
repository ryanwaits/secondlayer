import { describe, expect, mock, test } from "bun:test";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { withX402 } from "../x402.ts";

// Any valid 32-byte key works — sessions never reach the signing path here.
const account = privateKeyToAccount(
	"f9d7206a47f14d2870c163ebab4bf3e70d18f5d14ce1031f3902fbbc894fe63c01",
);

function resWith(headers: Record<string, string>, status = 200) {
	return new Response(JSON.stringify({ ok: true }), { status, headers });
}

describe("withX402 session vouchers", () => {
	test("caches PAYMENT-SESSION per origin and replays it", async () => {
		const seen: Array<Record<string, string>> = [];
		const baseFetch = mock(async (_input: unknown, init?: RequestInit) => {
			seen.push({ ...(init?.headers as Record<string, string>) });
			return seen.length === 1
				? resWith({ "PAYMENT-SESSION": "voucher-1" })
				: resWith({});
		});
		const f = withX402(baseFetch as unknown as typeof fetch, { account });

		await f("https://api.example.com/v1/streams/events");
		await f("https://api.example.com/v1/streams/events?cursor=1:2");

		expect(seen[0]["PAYMENT-SESSION"]).toBeUndefined();
		expect(seen[1]["PAYMENT-SESSION"]).toBe("voucher-1");
	});

	test("a 402 despite a cached voucher drops and replaces it", async () => {
		const seen: Array<Record<string, string>> = [];
		let calls = 0;
		const baseFetch = mock(async (_input: unknown, init?: RequestInit) => {
			seen.push({ ...(init?.headers as Record<string, string>) });
			calls++;
			if (calls === 1) return resWith({ "PAYMENT-SESSION": "stale" });
			// undecodable 402 (no challenge header, empty body) → returned as-is
			if (calls === 2) return new Response(null, { status: 402 });
			if (calls === 3) return resWith({ "PAYMENT-SESSION": "fresh" });
			return resWith({});
		});
		const f = withX402(baseFetch as unknown as typeof fetch, { account });

		await f("https://api.example.com/x"); // arms "stale"
		const second = await f("https://api.example.com/x"); // 402 → drop
		expect(second.status).toBe(402);
		await f("https://api.example.com/x"); // re-arms with "fresh"
		await f("https://api.example.com/x");

		expect(seen[1]["PAYMENT-SESSION"]).toBe("stale");
		expect(seen[2]["PAYMENT-SESSION"]).toBeUndefined(); // dropped
		expect(seen[3]["PAYMENT-SESSION"]).toBe("fresh");
	});
});
