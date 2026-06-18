import {
	type X402Network,
	type X402Token,
	X402_NETWORK,
} from "@secondlayer/shared/x402";
import { http, createWalletClient, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import type { ClarityValue } from "@secondlayer/stacks/clarity";
import {
	AuthType,
	type ContractCallPayload,
	PayloadType,
	PostConditionModeWire,
	type SingleSigSpendingCondition,
	type StacksTransaction,
	type TokenTransferPayload,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";
import { c32address } from "@secondlayer/stacks/utils";
import { sponsorAndBroadcast } from "@secondlayer/stacks/x402";
import {
	type MatchedTransfer,
	type VerifyTransferParams,
	type X402TransferAsset,
	verifyTransferByTxId,
} from "../index/transfer-by-txid.ts";

/**
 * x402 facilitator: static `verifyPayment` (decode the client's signed tx and
 * check it pays exactly what the challenge required) + `settlePayment` (sponsor +
 * broadcast, then block until the transfer is canonical — confirmed-tier). A
 * lazy-null singleton (`getX402FacilitatorOrNull`) returns null when no sponsor
 * key is configured, so route handlers respond 503 rather than 500 — same shape
 * as `getStripeOrNull`.
 */

export type X402PaymentRequirements = {
	payTo: string;
	/** Atomic units of `asset`. */
	amount: string | bigint;
	asset: X402Token;
	network: X402Network;
	/** When set, the on-chain memo must equal this challenge nonce (binds the tx
	 *  to the specific challenge). */
	nonce?: string;
};

export type X402RejectReason =
	| "decode_failed"
	| "not_sponsored"
	| "missing_signature"
	| "wrong_post_condition_mode"
	| "missing_post_condition"
	| "invalid_network"
	| "asset_mismatch"
	| "recipient_mismatch"
	| "value_mismatch"
	| "nonce_mismatch";

export type VerifyResult =
	| {
			ok: true;
			payer: string;
			txHex: string;
			recipient: string;
			amount: string;
			asset: X402TransferAsset;
	  }
	| { ok: false; reason: X402RejectReason };

const ZERO_SIG = "00".repeat(65);

const NETWORK_CHAIN_ID: Record<X402Network, number> = {
	[X402_NETWORK.mainnet]: 1,
	[X402_NETWORK.testnet]: 2147483648,
};

function cvPrincipal(cv: ClarityValue | undefined): string | null {
	if (cv && (cv.type === "address" || cv.type === "contract")) return cv.value;
	return null;
}

function cvUint(cv: ClarityValue | undefined): bigint | null {
	return cv && cv.type === "uint" ? cv.value : null;
}

/** Decode a SIP-010 `(some (buff ...))` memo arg to its UTF-8 string. */
function cvSomeBuffUtf8(cv: ClarityValue | undefined): string | null {
	if (cv?.type !== "some") return null;
	const inner = cv.value;
	if (inner?.type !== "buffer") return null;
	return Buffer.from(inner.value, "hex").toString("utf8");
}

function originSignaturePresent(tx: StacksTransaction): boolean {
	const cond = tx.auth.spendingCondition as SingleSigSpendingCondition;
	return typeof cond?.signature === "string" && cond.signature !== ZERO_SIG;
}

/** Stacks single-sig C32 address version per CAIP-2 network. */
function addressVersionFor(network: X402Network): number {
	return network === X402_NETWORK.mainnet ? 22 : 26;
}

/** The payer = the tx's origin, derived from the origin spending condition's
 *  signer hash160 (authoritative; works for STX, which carries no post-condition). */
function originAddress(tx: StacksTransaction, network: X402Network): string {
	const cond = tx.auth.spendingCondition as SingleSigSpendingCondition;
	return c32address(addressVersionFor(network), cond.signer);
}

/**
 * Statically verify a client's origin-signed sponsored transfer against the
 * challenge requirements. No broadcast, no network — pure structural checks. The
 * payer is derived from the origin spending condition (not a post-condition, so
 * it works for native STX too).
 *
 * Exactness is enforced differently per asset: native STX rides in the signed
 * TokenTransfer payload (which by consensus cannot carry post-conditions), while
 * SIP-010 transfers pin amount+asset with a Deny-mode FT post-condition.
 */
export function verifyPayment(
	txHex: string,
	requirements: X402PaymentRequirements,
): VerifyResult {
	let tx: StacksTransaction;
	try {
		tx = deserializeTransaction(txHex);
	} catch {
		return { ok: false, reason: "decode_failed" };
	}

	if (tx.auth.authType !== AuthType.Sponsored)
		return { ok: false, reason: "not_sponsored" };
	if (!originSignaturePresent(tx))
		return { ok: false, reason: "missing_signature" };
	if (tx.chainId !== NETWORK_CHAIN_ID[requirements.network])
		return { ok: false, reason: "invalid_network" };

	const payer = originAddress(tx, requirements.network);
	const requiredAmount = BigInt(requirements.amount);
	const isStx = requirements.asset.contractId === null;

	if (isStx) {
		// TokenTransfer payload: amount + recipient are signed into the payload, so
		// it IS the exact-amount guarantee. It must NOT carry post-conditions.
		if (tx.payload.payloadType !== PayloadType.TokenTransfer)
			return { ok: false, reason: "asset_mismatch" };
		if (tx.postConditions.length > 0)
			return { ok: false, reason: "wrong_post_condition_mode" };
		const payload = tx.payload as TokenTransferPayload;
		if (payload.amount !== requiredAmount)
			return { ok: false, reason: "value_mismatch" };
		if (cvPrincipal(payload.recipient) !== requirements.payTo)
			return { ok: false, reason: "recipient_mismatch" };
		if (requirements.nonce !== undefined && payload.memo !== requirements.nonce)
			return { ok: false, reason: "nonce_mismatch" };
		return {
			ok: true,
			payer,
			txHex,
			recipient: requirements.payTo,
			amount: requiredAmount.toString(),
			asset: { kind: "stx" },
		};
	}

	// SIP-010: Deny-mode FT post-condition pins exactly `requiredAmount` of the asset.
	if (tx.postConditionMode !== PostConditionModeWire.Deny)
		return { ok: false, reason: "wrong_post_condition_mode" };
	const pc = tx.postConditions.at(0);
	if (!pc || pc.type !== "ft")
		return { ok: false, reason: "missing_post_condition" };
	// biome-ignore lint/suspicious/noExplicitAny: post-condition wire shape read positionally
	const pcAny = pc as any;
	if (pcAny.amount !== requiredAmount)
		return { ok: false, reason: "value_mismatch" };
	const assetId = `${pcAny.asset?.address}.${pcAny.asset?.contractName}::${pcAny.asset?.assetName}`;
	if (assetId !== requirements.asset.assetIdentifier)
		return { ok: false, reason: "asset_mismatch" };
	if (tx.payload.payloadType !== PayloadType.ContractCall)
		return { ok: false, reason: "asset_mismatch" };
	const payload = tx.payload as ContractCallPayload;
	if (
		`${payload.contractAddress}.${payload.contractName}` !==
			requirements.asset.contractId ||
		payload.functionName !== "transfer"
	)
		return { ok: false, reason: "asset_mismatch" };
	const args = payload.functionArgs;
	if (cvUint(args[0]) !== requiredAmount)
		return { ok: false, reason: "value_mismatch" };
	if (cvPrincipal(args[2]) !== requirements.payTo)
		return { ok: false, reason: "recipient_mismatch" };
	if (
		requirements.nonce !== undefined &&
		cvSomeBuffUtf8(args[3]) !== requirements.nonce
	)
		return { ok: false, reason: "nonce_mismatch" };
	return {
		ok: true,
		payer,
		txHex,
		recipient: requirements.payTo,
		amount: requiredAmount.toString(),
		asset: { kind: "sip010", assetIdentifier: assetId },
	};
}

export type SettlementState = "confirmed" | "optimistic" | "pending";

export type SettlementResponse = {
	success: boolean;
	state: SettlementState;
	txid: string;
	payer: string;
	network: X402Network;
};

export type AwaitCanonicalOptions = {
	/** Stop polling after this long; a tx that never lands → `null`. */
	deadlineMs: number;
	intervalMs?: number;
	verifyTransfer?: (p: VerifyTransferParams) => Promise<MatchedTransfer | null>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

/**
 * Poll the by-txid Index reader until the transfer is canonical or the deadline
 * passes. Polls at least once (deadline 0 → single check). Returns the matched
 * canonical transfer, or `null` on timeout (caller marks the ledger `pending`).
 */
export async function awaitCanonical(
	params: VerifyTransferParams,
	options: AwaitCanonicalOptions,
): Promise<MatchedTransfer | null> {
	const verify = options.verifyTransfer ?? verifyTransferByTxId;
	const now = options.now ?? (() => Date.now());
	const sleep =
		options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const intervalMs = options.intervalMs ?? 2000;
	const start = now();

	for (;;) {
		const match = await verify(params);
		if (match) return match;
		if (now() - start >= options.deadlineMs) return null;
		await sleep(intervalMs);
	}
}

export type SettlePaymentArgs = {
	txHex: string;
	payer: string;
	recipient: string;
	amount: string | bigint;
	asset: X402TransferAsset;
	network: X402Network;
	maxTimeoutSeconds: number;
	/** Broadcast the sponsored tx and return its txid. */
	broadcast: (txHex: string) => Promise<{ txid: string }>;
	awaitOptions?: Partial<Omit<AwaitCanonicalOptions, "deadlineMs">>;
	/** Optimistic: broadcast and return immediately (`state: "optimistic"`) instead
	 *  of blocking on canonical confirmation. The reconciler advances the ledger. */
	optimistic?: boolean;
};

/**
 * Settle a verified payment. Confirmed-tier (default): broadcast, then block
 * until canonical — `state: "confirmed"`, or `"pending"` on timeout (caller
 * retries later). Optimistic (`optimistic: true`): broadcast and return at once
 * with `state: "optimistic"` (the node accepted it into the mempool); the caller
 * serves immediately and the reconciler advances it to confirmed|reverted.
 */
export async function settlePayment(
	args: SettlePaymentArgs,
): Promise<SettlementResponse> {
	if (args.optimistic) {
		const { txid } = await args.broadcast(args.txHex);
		return {
			success: true,
			state: "optimistic",
			txid,
			payer: args.payer,
			network: args.network,
		};
	}
	const { txid } = await args.broadcast(args.txHex);
	const match = await awaitCanonical(
		{
			txid,
			recipient: args.recipient,
			amount: args.amount,
			asset: args.asset,
		},
		{ deadlineMs: args.maxTimeoutSeconds * 1000, ...args.awaitOptions },
	);
	return {
		success: match !== null,
		state: match ? "confirmed" : "pending",
		txid,
		payer: args.payer,
		network: args.network,
	};
}

export type X402Facilitator = {
	network: X402Network;
	payTo: string | null;
	settle: (
		args: Omit<SettlePaymentArgs, "broadcast" | "network">,
	) => Promise<SettlementResponse>;
};

let cached: X402Facilitator | null = null;

/**
 * Lazy facilitator singleton. Returns null when `X402_SPONSOR_KEY` is unset so
 * route handlers respond 503 (per `getStripeOrNull`). When configured, wires the
 * real sponsor wallet + `/v2/transactions` broadcast.
 */
export function getX402FacilitatorOrNull(): X402Facilitator | null {
	if (cached) return cached;
	const sponsorKey = process.env.X402_SPONSOR_KEY;
	if (!sponsorKey) return null;

	const account = privateKeyToAccount(sponsorKey);
	const client = createWalletClient({
		chain: mainnet,
		transport: http(),
		account,
	});
	const broadcast = (txHex: string) => sponsorAndBroadcast(client, txHex);

	cached = {
		network: X402_NETWORK.mainnet,
		payTo: process.env.X402_PAY_TO ?? null,
		settle: (args) =>
			settlePayment({ ...args, network: X402_NETWORK.mainnet, broadcast }),
	};
	return cached;
}

/** Reset the memoized singleton (tests only). */
export function _resetX402FacilitatorForTests(): void {
	cached = null;
}

/**
 * Whether the x402 rail is live. Requires a configured sponsor key, and can be
 * killed independently via `X402_ENABLED=false` — so ops can disable the rail
 * without rotating the funded sponsor wallet. When false, surfaces keep their
 * pre-x402 behavior (Streams stays key-mandatory, Index anon reads stay free).
 * Mounting is decided at module load, so toggling needs a redeploy/recreate, not
 * just a restart.
 */
export function isX402Enabled(): boolean {
	if (process.env.X402_ENABLED === "false") return false;
	return Boolean(process.env.X402_SPONSOR_KEY);
}
