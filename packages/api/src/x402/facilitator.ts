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
	| "value_mismatch";

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

function originSignaturePresent(tx: StacksTransaction): boolean {
	const cond = tx.auth.spendingCondition as SingleSigSpendingCondition;
	return typeof cond?.signature === "string" && cond.signature !== ZERO_SIG;
}

/**
 * Statically verify a client's origin-signed sponsored transfer against the
 * challenge requirements. No broadcast, no network — pure structural checks. The
 * payer is read from the post-condition principal (the same field the Deny-mode
 * PC pins), so we never recover it from the signature.
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
	if (tx.postConditionMode !== PostConditionModeWire.Deny)
		return { ok: false, reason: "wrong_post_condition_mode" };
	if (tx.chainId !== NETWORK_CHAIN_ID[requirements.network])
		return { ok: false, reason: "invalid_network" };

	const pc = tx.postConditions.at(0);
	if (!pc) return { ok: false, reason: "missing_post_condition" };

	const requiredAmount = BigInt(requirements.amount);
	const isStx = requirements.asset.contractId === null;

	// The Deny-mode post-condition is the binding guarantee — assert it pins
	// exactly `requiredAmount` of the right asset leaving the payer.
	// biome-ignore lint/suspicious/noExplicitAny: post-condition wire shape is a discriminated union read positionally
	const pcAny = pc as any;
	if (pcAny.amount !== requiredAmount)
		return { ok: false, reason: "value_mismatch" };
	const payer: string | null = pcAny.principal?.address ?? null;
	if (!payer) return { ok: false, reason: "missing_post_condition" };

	if (isStx) {
		if (pc.type !== "stx") return { ok: false, reason: "asset_mismatch" };
		if (tx.payload.payloadType !== PayloadType.TokenTransfer)
			return { ok: false, reason: "asset_mismatch" };
		const payload = tx.payload as TokenTransferPayload;
		if (payload.amount !== requiredAmount)
			return { ok: false, reason: "value_mismatch" };
		if (cvPrincipal(payload.recipient) !== requirements.payTo)
			return { ok: false, reason: "recipient_mismatch" };
		return {
			ok: true,
			payer,
			txHex,
			recipient: requirements.payTo,
			amount: requiredAmount.toString(),
			asset: { kind: "stx" },
		};
	}

	// SIP-010
	if (pc.type !== "ft") return { ok: false, reason: "asset_mismatch" };
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
	return {
		ok: true,
		payer,
		txHex,
		recipient: requirements.payTo,
		amount: requiredAmount.toString(),
		// `assetId` equals `requirements.asset.assetIdentifier` here (checked above)
		// and is always a string — avoids a non-null assertion on the nullable field.
		asset: { kind: "sip010", assetIdentifier: assetId },
	};
}

export type SettlementState = "confirmed" | "pending";

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
};

/**
 * Broadcast a verified payment, then block until it is canonical (confirmed-tier).
 * On timeout the response is `state: "pending"` — the tx may still land; the
 * caller decides whether to retry-later or reconcile.
 */
export async function settlePayment(
	args: SettlePaymentArgs,
): Promise<SettlementResponse> {
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
