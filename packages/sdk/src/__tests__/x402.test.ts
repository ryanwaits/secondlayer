import { afterEach, describe, expect, test } from "bun:test";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	type X402Challenge,
	X402SpendGuardError,
	createX402Client,
	readX402Receipt,
	resolveAccountNonce,
	selectOffer,
	withX402,
} from "../x402.ts";

const account = privateKeyToAccount(
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01",
);
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

function b64(v: unknown): string {
	return Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}

// Challenge offering sBTC (2000) + USDCx (1000).
function challenge(): X402Challenge {
	return {
		x402Version: 2,
		accepts: [
			offer(X402_TOKENS.sBTC.asset, "2000"),
			offer(X402_TOKENS.USDCx.asset, "1000"),
		],
	};
}
function offer(asset: string, amount: string) {
	return {
		scheme: "exact" as const,
		network: X402_NETWORK.mainnet,
		asset,
		amount,
		payTo: PAY_TO,
		maxTimeoutSeconds: 60,
		extra: { nonce: "x402nonce0001" },
	};
}

describe("selectOffer", () => {
	test("defaults to sBTC-first (Bitcoin-native)", () => {
		expect(selectOffer(challenge()).symbol).toBe("sBTC");
	});
	test("spend guard skips an over-cap asset and falls to the next", () => {
		const { symbol } = selectOffer(challenge(), {
			maxAmountPerCall: { sBTC: 1000n }, // sBTC offer is 2000 → skip → USDCx
		});
		expect(symbol).toBe("USDCx");
	});
	test("throws when nothing is within the guard / preferences", () => {
		expect(() =>
			selectOffer(challenge(), {
				preferAssets: ["sBTC"],
				maxAmountPerCall: { sBTC: 100n },
			}),
		).toThrow(X402SpendGuardError);
	});
});

function payingFetch(): typeof fetch {
	let calls = 0;
	return (async (_input: string | URL, init?: RequestInit) => {
		calls++;
		if (calls === 1) {
			const ch = challenge();
			return new Response(JSON.stringify(ch), {
				status: 402,
				headers: { "PAYMENT-REQUIRED": b64(ch) },
			});
		}
		expect(
			(init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"],
		).toBeTruthy();
		return new Response(JSON.stringify({ events: [{ tx_id: "0x01" }] }), {
			status: 200,
			headers: {
				"content-type": "application/json",
				"PAYMENT-RESPONSE": b64({
					success: true,
					txid: "0xsettled",
					payer: account.address,
					network: X402_NETWORK.mainnet,
				}),
			},
		});
	}) as unknown as typeof fetch;
}

describe("withX402", () => {
	test("402 → selects sBTC, pays, retries; receipt readable", async () => {
		const x402fetch = withX402(payingFetch(), { account, accountNonce: 0n });
		const res = await x402fetch(
			"https://api.secondlayer.tools/v1/index/events",
		);
		expect(res.status).toBe(200);
		expect(readX402Receipt(res)).toMatchObject({
			success: true,
			txid: "0xsettled",
		});
	});

	test("non-402 passes through untouched", async () => {
		let calls = 0;
		const f = (async () => {
			calls++;
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;
		const res = await withX402(f, { account, accountNonce: 0n })("https://x/y");
		expect(res.status).toBe(200);
		expect(calls).toBe(1);
	});
});

describe("createX402Client", () => {
	test(".get returns parsed data + the settlement receipt", async () => {
		const sl = createX402Client({
			account,
			accountNonce: 0n,
			baseUrl: "https://api.secondlayer.tools",
			fetch: payingFetch(),
		});
		const { data, payment } = await sl.get<{ events: { tx_id: string }[] }>(
			"/v1/index/events",
			{ query: { event_type: "ft_transfer" } },
		);
		expect(data.events[0]?.tx_id).toBe("0x01");
		expect(payment).toMatchObject({ txid: "0xsettled" });
	});
});

describe("resolveAccountNonce", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	test("reads the account nonce from /v2/accounts", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ nonce: 7, balance: "0x0" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		expect(await resolveAccountNonce("SP123", "https://node")).toBe(7);
	});
});
