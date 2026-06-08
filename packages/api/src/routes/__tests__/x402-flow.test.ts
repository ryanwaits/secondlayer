import { describe, expect, test } from "bun:test";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	serializeTransactionHex,
	signTransactionWithAccount,
} from "@secondlayer/stacks/transactions";
import { buildExactTransfer } from "@secondlayer/stacks/x402";
import { Hono } from "hono";
import type { IndexEventsReader } from "../../index/events.ts";
import type { IndexTip } from "../../index/tip.ts";
import { errorHandler } from "../../middleware/error.ts";
import type { X402Facilitator } from "../../x402/facilitator.ts";
import type { X402PaymentRecord } from "../../x402/ledger.ts";
import { x402PaymentRequired } from "../../x402/middleware.ts";
import { InProcNonceStore } from "../../x402/nonce-store.ts";
import { createIndexRouter } from "../index.ts";

/**
 * Full x402 flow against the REAL Index router (not a stub): an accountless agent
 * hits `/v1/index/events` with no key, gets a 402, signs a real sponsored USDCx
 * payment, retries, and the REAL handler returns data. The only injected piece is
 * the chain settle (a confirming facilitator) — `verifyPayment`, the wire codec,
 * the anon path, mount order, nonce store, ledger write, and the handler are all
 * real. This is the pre-release "does the whole thing work end to end" CI gate;
 * the on-chain settle itself is proven separately on devnet.
 */

const payer = privateKeyToAccount(
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01",
);
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

// The real handler is reached only after payment — it returns this row.
const EVENT = {
	cursor: "100:0",
	block_height: 100,
	tx_id: "0x01",
	tx_index: 0,
	event_index: 0,
	event_type: "ft_transfer" as const,
	contract_id: "SP123.token",
	asset_identifier: "SP123.token::coin",
	sender: "SP123.sender",
	recipient: "SP123.recipient",
	amount: "5",
};
const readEvents: IndexEventsReader = async () => ({
	events: [EVENT],
	next_cursor: null,
});

function confirmingFacilitator(): X402Facilitator {
	return {
		network: X402_NETWORK.mainnet,
		payTo: PAY_TO,
		settle: async (args) => ({
			success: true,
			state: "confirmed",
			txid: "0xsettled",
			payer: args.payer,
			network: X402_NETWORK.mainnet,
		}),
	};
}

function b64decode<T>(v: string): T {
	return JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;
}
function b64encode(v: unknown): string {
	return Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}

async function usdcxPayment(amount: string, nonce: string): Promise<string> {
	const t = X402_TOKENS.USDCx;
	if (!t.contractId || !t.assetName) throw new Error("USDCx config");
	const tx = buildExactTransfer({
		asset: { kind: "sip010", contractId: t.contractId, assetName: t.assetName },
		amount: BigInt(amount),
		payTo: PAY_TO,
		payer: payer.address,
		payerPublicKey: payer.publicKey,
		accountNonce: 0n,
		nonce,
	});
	const signed = await signTransactionWithAccount(tx, payer);
	return b64encode({
		x402Version: 2,
		scheme: "exact",
		network: X402_NETWORK.mainnet,
		asset: t.asset,
		payload: { transaction: serializeTransactionHex(signed) },
		extra: { nonce },
	});
}

const PATH = "/events?event_type=ft_transfer&from_height=0";

function build(ledger: X402PaymentRecord[]) {
	// Mirror production: the router is mounted under the main app, which registers
	// the global error handler that maps a thrown PaymentRequiredError to 402.
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/",
		createIndexRouter({
			getTip: async () => TIP,
			readEvents,
			readReorgs: async () => [],
			// Inject a fully-built x402 middleware backed by fakes — same shape the
			// app root mounts in production, minus the real chain settle.
			x402Middleware: x402PaymentRequired({
				surface: "index",
				facilitator: confirmingFacilitator(),
				nonceStore: new InProcNonceStore(),
				insertPayment: async (rec) => {
					ledger.push(rec);
				},
			}),
		}),
	);
	return app;
}

describe("x402 full flow against the real Index router", () => {
	test("accountless request is challenged, pays, and gets real data", async () => {
		const ledger: X402PaymentRecord[] = [];
		const router = build(ledger);

		// 1. No key, no payment → 402 challenge.
		const challengeRes = await router.request(PATH);
		expect(challengeRes.status).toBe(402);
		const challenge = b64decode<{
			accepts: { asset: string; amount: string; extra: { nonce: string } }[];
		}>(challengeRes.headers.get("PAYMENT-REQUIRED") as string);
		const offer = challenge.accepts.find(
			(a) => a.asset === X402_TOKENS.USDCx.asset,
		);
		if (!offer) throw new Error("no USDCx offer");

		// 2. Sign + retry.
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		const ok = await router.request(PATH, {
			headers: { "PAYMENT-SIGNATURE": sig },
		});

		// 3. Real handler ran → real data + receipt + ledger row.
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { events: { tx_id: string }[] };
		expect(body.events[0]?.tx_id).toBe("0x01");
		const receipt = b64decode<{ success: boolean; txid: string }>(
			ok.headers.get("PAYMENT-RESPONSE") as string,
		);
		expect(receipt).toMatchObject({ success: true, txid: "0xsettled" });
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({ surface: "index", state: "confirmed" });
	});

	test("a keyless request without payment never reaches the handler", async () => {
		const res = await build([]).request(PATH);
		expect(res.status).toBe(402); // gated before the real reader runs
	});

	test("replaying the same payment is rejected", async () => {
		const router = build([]);
		const challenge = b64decode<{
			accepts: { asset: string; amount: string; extra: { nonce: string } }[];
		}>((await router.request(PATH)).headers.get("PAYMENT-REQUIRED") as string);
		const offer = challenge.accepts.find(
			(a) => a.asset === X402_TOKENS.USDCx.asset,
		);
		if (!offer) throw new Error("no USDCx offer");
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		expect(
			(await router.request(PATH, { headers: { "PAYMENT-SIGNATURE": sig } }))
				.status,
		).toBe(200);
		const replay = await router.request(PATH, {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(replay.status).toBe(402);
	});
});
