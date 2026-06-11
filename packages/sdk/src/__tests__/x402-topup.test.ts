import { describe, expect, mock, test } from "bun:test";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { withX402 } from "../x402.ts";

const account = privateKeyToAccount(
	"f9d7206a47f14d2870c163ebab4bf3e70d18f5d14ce1031f3902fbbc894fe63c01",
);

function resWith(
	headers: Record<string, string>,
	body: unknown = { ok: true },
) {
	return new Response(JSON.stringify(body), { status: 200, headers });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withX402 prepaid balance + topUp", () => {
	test("attaches PAYMENT-BALANCE when a token is configured", async () => {
		const seen: Array<Record<string, string>> = [];
		const baseFetch = mock(async (_i: unknown, init?: RequestInit) => {
			seen.push({ ...(init?.headers as Record<string, string>) });
			return resWith({});
		});
		const f = withX402(baseFetch as unknown as typeof fetch, {
			account,
			balanceToken: "tab-token",
		});
		await f("https://api.example.com/v1/index/events");
		expect(seen[0]["PAYMENT-BALANCE"]).toBe("tab-token");
	});

	test("sub-threshold remaining triggers one background deposit and adopts the fresh token", async () => {
		const calls: string[] = [];
		const seen: Array<Record<string, string>> = [];
		const baseFetch = mock(async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			calls.push(`${init?.method ?? "GET"} ${url}`);
			seen.push({ ...(init?.headers as Record<string, string>) });
			if (url.includes("/v1/x402/deposit")) {
				return resWith({}, { balance_token: "fresh-token", balance_usd: 10.4 });
			}
			return resWith({ "X-BALANCE-REMAINING-USD": "0.400000" });
		});
		const f = withX402(baseFetch as unknown as typeof fetch, {
			account,
			balanceToken: "old-token",
			topUp: { usd: 10, whenBelow: 0.5 },
		});

		await f("https://api.example.com/v1/index/events");
		await sleep(20); // background top-up settles

		const deposits = calls.filter((c) => c.includes("/v1/x402/deposit"));
		expect(deposits).toEqual([
			"POST https://api.example.com/v1/x402/deposit?usd=10",
		]);

		await f("https://api.example.com/v1/index/events");
		const last = seen[seen.length - 1];
		expect(last["PAYMENT-BALANCE"]).toBe("fresh-token");
	});

	test("healthy balance never triggers a deposit", async () => {
		const calls: string[] = [];
		const baseFetch = mock(async (input: unknown, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${String(input)}`);
			return resWith({ "X-BALANCE-REMAINING-USD": "9.000000" });
		});
		const f = withX402(baseFetch as unknown as typeof fetch, {
			account,
			balanceToken: "tab",
			topUp: { usd: 10, whenBelow: 0.5 },
		});
		await f("https://api.example.com/v1/index/events");
		await sleep(20);
		expect(calls.some((c) => c.includes("/deposit"))).toBe(false);
	});
});
