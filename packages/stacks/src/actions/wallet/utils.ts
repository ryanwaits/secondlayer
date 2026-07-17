import type { ProviderAccount } from "../../accounts/types.ts";
import type { Account, Client } from "../../clients/types.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import {
	clearTxCache,
	serializeTransaction,
} from "../../transactions/wire/serialize.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { intToBigInt } from "../../utils/encoding.ts";
import { estimateFee } from "../public/estimateFee.ts";

export function isProviderAccount(
	account: Account,
): account is ProviderAccount {
	return account.type === "provider";
}

/**
 * Named fee tiers. `'low' | 'mid' | 'high'` map to the node's three fee
 * estimations; `'min'` is the node's minimum relay fee — 1 uSTX per byte of
 * the serialized transaction, computable offline.
 */
export type FeeTier = "min" | "low" | "mid" | "high";

/** Fee input accepted by wallet actions: an explicit amount or a named tier. */
export type FeeParam = IntegerType | FeeTier;

const FEE_TIERS: readonly FeeTier[] = ["min", "low", "mid", "high"];
const TIER_INDEX = { low: 0, mid: 1, high: 2 } as const;

export function isFeeTier(fee: FeeParam | undefined): fee is FeeTier {
	return typeof fee === "string" && FEE_TIERS.includes(fee as FeeTier);
}

/**
 * Minimum relay fee: 1 uSTX per byte of the serialized transaction. The fee
 * field is fixed-width (8 bytes), so the size — and therefore this floor — is
 * stable regardless of the fee value later set on the spending condition.
 */
export function minimumFee(transaction: StacksTransaction): bigint {
	return BigInt(serializeTransaction(transaction).length);
}

/**
 * Resolve a fee param to a concrete amount. Numeric input passes through.
 * Tiers `'low' | 'mid' | 'high'` index the node's estimations (nearest
 * available when fewer than three are returned); `'min'` — and any estimation
 * failure (e.g. NoEstimateAvailable) — resolves to {@link minimumFee}, which
 * needs no network round-trip.
 */
export async function resolveFee(
	client: Client,
	transaction: StacksTransaction,
	fee: FeeParam | undefined,
): Promise<bigint> {
	if (fee !== undefined && !isFeeTier(fee)) return intToBigInt(fee);

	const tier = fee ?? "mid";
	if (tier === "min") return minimumFee(transaction);

	try {
		const estimates = await estimateFee(client, { transaction });
		const pick = estimates[TIER_INDEX[tier]] ?? estimates[estimates.length - 1];
		if (pick) return BigInt(pick.fee);
	} catch {
		// Node could not produce an estimate — fall through to the relay floor.
	}
	return minimumFee(transaction);
}

/** Set the resolved fee on an unsigned transaction's origin spending condition. */
export function setUnsignedFee(
	transaction: StacksTransaction,
	fee: bigint,
): void {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	(transaction.auth.spendingCondition as any).fee = fee;
	// In-place mutation: invalidate the memoized serialization (resolveFee may
	// have already serialized this object via minimumFee/estimateFee).
	clearTxCache(transaction);
}

/** Throw when a named fee tier is used with a provider (wallet) account. */
export function assertNoFeeTierForProvider(fee: FeeParam | undefined): void {
	if (isFeeTier(fee)) {
		throw new Error(
			`Fee tier '${fee}' requires local signing; provider (wallet) accounts set their own fee`,
		);
	}
}
