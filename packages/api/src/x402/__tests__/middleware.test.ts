import { describe, expect, test } from "bun:test";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import {
	serializeTransactionHex,
	signTransactionWithAccount,
} from "@secondlayer/stacks/transactions";
import { buildExactTransfer } from "@secondlayer/stacks/x402";
import { Hono } from "hono";
import { errorHandler } from "../../middleware/error.ts";
import type { X402Facilitator } from "../facilitator.ts";
import type { X402PaymentRecord } from "../ledger.ts";
import { type X402Challenge, x402PaymentRequired } from "../middleware.ts";
import { InProcNonceStore } from "../nonce-store.ts";
import {
	InProcOptimisticGate,
	type OptimisticGate,
} from "../optimistic-gate.ts";

const ORIGIN_KEY =
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01";
const payer = privateKeyToAccount(ORIGIN_KEY);
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

function b64decode<T>(v: string): T {
	return JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;
}
function b64encode(v: unknown): string {
	return Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}

/** Honors `args.optimistic` (→ state "optimistic"); else returns `fallback`. */
function fakeFacilitator(
	fallback: "confirmed" | "pending" = "confirmed",
): X402Facilitator {
	return {
		network: X402_NETWORK.mainnet,
		payTo: PAY_TO,
		settle: async (args) => ({
			success: args.optimistic ? true : fallback === "confirmed",
			state: args.optimistic ? "optimistic" : fallback,
			txid: "0xsettled",
			payer: args.payer,
			network: X402_NETWORK.mainnet,
		}),
	};
}

/** A gate that always forces confirmed-tier (optimism denied). */
const denyOptimism: OptimisticGate = {
	canServeOptimistically: async () => false,
	recordStrike: async () => {},
	clear: async () => {},
};

async function usdcxPayment(amount: string, nonce: string): Promise<string> {
	const usdcx = X402_TOKENS.USDCx;
	if (!usdcx.contractId || !usdcx.assetName) throw new Error("USDCx config");
	const tx = buildExactTransfer({
		asset: {
			kind: "sip010",
			contractId: usdcx.contractId,
			assetName: usdcx.assetName,
		},
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
		asset: usdcx.asset,
		payload: { transaction: serializeTransactionHex(signed) },
		extra: { nonce },
	});
}

function buildApp(opts: {
	facilitator: X402Facilitator;
	nonceStore: InProcNonceStore;
	ledger: X402PaymentRecord[];
	accountBacked?: boolean;
	optimisticGate?: OptimisticGate;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	app.use(
		"*",
		x402PaymentRequired({
			surface: "index",
			payTo: PAY_TO,
			facilitator: opts.facilitator,
			nonceStore: opts.nonceStore,
			optimisticGate: opts.optimisticGate ?? new InProcOptimisticGate(),
			isAccountBacked: () => opts.accountBacked ?? false,
			insertPayment: async (rec) => {
				opts.ledger.push(rec);
			},
			recordSpend: async () => {}, // no-op: spend funnel isn't under test (no DB)
		}),
	);
	app.get("/x", (c) => c.json({ data: "ok" }));
	return app;
}

/** App with the free-quota ladder: first `limit` anonymous calls pass through. */
function buildQuotaApp(opts: {
	facilitator: X402Facilitator;
	nonceStore: InProcNonceStore;
	limit: number;
}) {
	let used = 0;
	const app = new Hono();
	app.onError(errorHandler);
	app.use(
		"*",
		x402PaymentRequired({
			surface: "index",
			payTo: PAY_TO,
			facilitator: opts.facilitator,
			nonceStore: opts.nonceStore,
			optimisticGate: new InProcOptimisticGate(),
			isAccountBacked: () => false,
			insertPayment: async () => {},
			recordSpend: async () => {}, // no-op: spend funnel isn't under test (no DB)
			freeQuota: { limit: opts.limit, windowMs: 60_000 },
			quotaStore: {
				check: async (_key, limit) => ({ allowed: ++used <= limit }),
			},
		}),
	);
	app.get("/x", (c) => c.json({ data: "ok" }));
	return app;
}

async function challengeOffer(app: ReturnType<typeof buildApp>) {
	const challenge = b64decode<X402Challenge>(
		(await app.request("/x")).headers.get("PAYMENT-REQUIRED") as string,
	);
	const offer = challenge.accepts.find(
		(a) => a.asset === X402_TOKENS.USDCx.asset,
	);
	if (!offer) throw new Error("no USDCx offer");
	return offer;
}

describe("x402PaymentRequired", () => {
	test("no payment → 402 with a decodable PAYMENT-REQUIRED challenge", async () => {
		const app = buildApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			ledger: [],
		});
		const res = await app.request("/x");
		expect(res.status).toBe(402);
		const challenge = b64decode<X402Challenge>(
			res.headers.get("PAYMENT-REQUIRED") as string,
		);
		expect(challenge.x402Version).toBe(2);
		const usdcx = challenge.accepts.find(
			(a) => a.asset === X402_TOKENS.USDCx.asset,
		);
		expect(usdcx?.amount).toBe("1000"); // $0.001 * 1e6
		expect(usdcx?.extra.nonce).toBeTruthy();
	});

	test("account-backed caller bypasses x402 (200, no challenge)", async () => {
		const app = buildApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			ledger: [],
			accountBacked: true,
		});
		const res = await app.request("/x");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: "ok" });
	});

	test("optimistic (Index default) → 200 immediately, receipt state=optimistic, ledger pending", async () => {
		const nonceStore = new InProcNonceStore();
		const ledger: X402PaymentRecord[] = [];
		const app = buildApp({
			facilitator: fakeFacilitator(),
			nonceStore,
			ledger,
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);

		const res = await app.request("/x", {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: "ok" });
		const receipt = b64decode<{ state: string; txid: string }>(
			res.headers.get("PAYMENT-RESPONSE") as string,
		);
		expect(receipt).toMatchObject({ state: "optimistic", txid: "0xsettled" });
		expect(ledger[0]).toMatchObject({ state: "pending", surface: "index" });
	});

	test("confirmed-tier (gate denies optimism) → ledger confirmed", async () => {
		const ledger: X402PaymentRecord[] = [];
		const app = buildApp({
			facilitator: fakeFacilitator("confirmed"),
			nonceStore: new InProcNonceStore(),
			ledger,
			optimisticGate: denyOptimism,
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		const res = await app.request("/x", {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(200);
		const receipt = b64decode<{ state: string }>(
			res.headers.get("PAYMENT-RESPONSE") as string,
		);
		expect(receipt.state).toBe("confirmed");
		expect(ledger[0]).toMatchObject({ state: "confirmed" });
	});

	test("replaying the same nonce → 402 (nonce_replayed)", async () => {
		const nonceStore = new InProcNonceStore();
		const app = buildApp({
			facilitator: fakeFacilitator(),
			nonceStore,
			ledger: [],
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		expect(
			(await app.request("/x", { headers: { "PAYMENT-SIGNATURE": sig } }))
				.status,
		).toBe(200);
		const replay = await app.request("/x", {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(replay.status).toBe(402);
		const body = (await replay.json()) as { details?: unknown };
		expect(body.details).toMatchObject({ reason: "nonce_replayed" });
	});

	test("confirmed-tier broadcast-but-not-canonical → 402 (awaiting_confirmation)", async () => {
		const app = buildApp({
			facilitator: fakeFacilitator("pending"),
			nonceStore: new InProcNonceStore(),
			ledger: [],
			optimisticGate: denyOptimism, // force confirmed-tier so it can time out
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		const res = await app.request("/x", {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(res.status).toBe(402);
		const body = (await res.json()) as { details?: unknown };
		expect(body.details).toMatchObject({
			reason: "awaiting_confirmation",
			txid: "0xsettled",
		});
	});
});

describe("free-quota ladder", () => {
	test("anonymous calls under the quota fall through (no 402)", async () => {
		const app = buildQuotaApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			limit: 2,
		});
		expect((await app.request("/x")).status).toBe(200);
		expect((await app.request("/x")).status).toBe(200);
	});

	test("quota exhaustion starts the 402 challenge", async () => {
		const app = buildQuotaApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			limit: 1,
		});
		expect((await app.request("/x")).status).toBe(200);
		const res = await app.request("/x");
		expect(res.status).toBe(402);
		expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
	});

	test("without freeQuota the first call still 402s (default unchanged)", async () => {
		const app = buildApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			ledger: [],
		});
		expect((await app.request("/x")).status).toBe(402);
	});
});

describe("session pricing (streams-style)", () => {
	const SECRET = "session-test-secret";

	function buildSessionApp(opts: {
		facilitator: X402Facilitator;
		nonceStore: InProcNonceStore;
		maxCalls: number;
	}) {
		let used = 0;
		const app = new Hono();
		app.onError(errorHandler);
		app.use(
			"*",
			x402PaymentRequired({
				surface: "index",
				payTo: PAY_TO,
				facilitator: opts.facilitator,
				nonceStore: opts.nonceStore,
				optimisticGate: new InProcOptimisticGate(),
				isAccountBacked: () => false,
				insertPayment: async () => {},
				recordSpend: async () => {}, // no-op: spend funnel isn't under test (no DB)
				session: { ttlMs: 60_000, maxCalls: opts.maxCalls, secret: SECRET },
				quotaStore: {
					check: async (_key, limit) => ({ allowed: ++used <= limit }),
				},
			}),
		);
		app.get("/x", (c) => c.json({ data: "ok" }));
		return app;
	}

	test("settle mints a PAYMENT-SESSION voucher; voucher rides free until exhausted", async () => {
		const app = buildSessionApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			maxCalls: 2,
		});
		const offer = await challengeOffer(app);
		const sig = await usdcxPayment(offer.amount, offer.extra.nonce);
		const paid = await app.request("/x", {
			headers: { "PAYMENT-SIGNATURE": sig },
		});
		expect(paid.status).toBe(200);
		const voucher = paid.headers.get("PAYMENT-SESSION");
		expect(voucher).toBeTruthy();

		// two free rides on the session budget…
		for (let i = 0; i < 2; i++) {
			const res = await app.request("/x", {
				headers: { "PAYMENT-SESSION": voucher as string },
			});
			expect(res.status).toBe(200);
		}
		// …then the 402 cycle restarts
		const exhausted = await app.request("/x", {
			headers: { "PAYMENT-SESSION": voucher as string },
		});
		expect(exhausted.status).toBe(402);
	});

	test("forged voucher is ignored (402)", async () => {
		const app = buildSessionApp({
			facilitator: fakeFacilitator(),
			nonceStore: new InProcNonceStore(),
			maxCalls: 5,
		});
		const res = await app.request("/x", {
			headers: { "PAYMENT-SESSION": "ZmFrZQ.ZmFrZQ" },
		});
		expect(res.status).toBe(402);
	});
});
