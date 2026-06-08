import { describe, expect, test } from "bun:test";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	type TokenTransferPayload,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";
import {
	type X402Challenge,
	buildSignedX402Payment,
	payAndRetry,
} from "../x402.ts";

const account = privateKeyToAccount(
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01",
);
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

function challenge(asset: string, amount: string): X402Challenge {
	return {
		x402Version: 2,
		accepts: [
			{
				scheme: "exact",
				network: X402_NETWORK.mainnet,
				asset,
				amount,
				payTo: PAY_TO,
				maxTimeoutSeconds: 60,
				extra: { nonce: "x402nonce0001" },
			},
		],
	};
}

function decodeHeader(header: string): {
	asset: string;
	payload: { transaction: string };
	extra: { nonce: string };
} {
	return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

describe("buildSignedX402Payment", () => {
	test("STX: produces a payload whose tx pays the offer exactly", async () => {
		const { header, accept } = await buildSignedX402Payment({
			challenge: challenge(X402_TOKENS.STX.asset, "1000"),
			account,
			accountNonce: 0n,
		});
		expect(accept.asset).toBe("STX");
		const decoded = decodeHeader(header);
		expect(decoded.asset).toBe("STX");
		expect(decoded.extra.nonce).toBe("x402nonce0001");

		const tx = deserializeTransaction(decoded.payload.transaction);
		const payload = tx.payload as TokenTransferPayload;
		expect(payload.amount).toBe(1000n);
		expect(payload.memo).toBe("x402nonce0001");
	});

	test("USDCx (SIP-010): selects the offer by asset string", async () => {
		const { header } = await buildSignedX402Payment({
			challenge: challenge(X402_TOKENS.USDCx.asset, "1000"),
			account,
			accountNonce: 0n,
			asset: X402_TOKENS.USDCx.asset,
		});
		expect(decodeHeader(header).asset).toBe(X402_TOKENS.USDCx.asset);
	});

	test("throws when the requested asset is not offered", async () => {
		await expect(
			buildSignedX402Payment({
				challenge: challenge(X402_TOKENS.STX.asset, "1000"),
				account,
				accountNonce: 0n,
				asset: "SP000.nope",
			}),
		).rejects.toThrow(/No x402 offer/);
	});
});

describe("payAndRetry", () => {
	test("402 → pays and retries once with PAYMENT-SIGNATURE", async () => {
		let calls = 0;
		const doFetch = async (headers: Record<string, string>) => {
			calls++;
			if (calls === 1) {
				const ch = challenge(X402_TOKENS.STX.asset, "1000");
				return new Response(JSON.stringify(ch), {
					status: 402,
					headers: {
						"PAYMENT-REQUIRED": Buffer.from(JSON.stringify(ch)).toString(
							"base64",
						),
					},
				});
			}
			expect(headers["PAYMENT-SIGNATURE"]).toBeTruthy();
			return new Response("ok", { status: 200 });
		};
		const res = await payAndRetry(doFetch, { account, accountNonce: 0n });
		expect(res.status).toBe(200);
		expect(calls).toBe(2);
	});

	test("non-402 passes through untouched", async () => {
		let calls = 0;
		const res = await payAndRetry(
			async () => {
				calls++;
				return new Response("ok", { status: 200 });
			},
			{ account, accountNonce: 0n },
		);
		expect(res.status).toBe(200);
		expect(calls).toBe(1);
	});
});
