import type { StacksChain } from "../chains/types.ts";
import { Cl } from "../clarity/values.ts";
import { Pc } from "../postconditions/builder.ts";
import type { PostCondition } from "../postconditions/types.ts";
import {
	buildContractCall,
	buildTokenTransfer,
} from "../transactions/build.ts";
import {
	MEMO_MAX_LENGTH_BYTES,
	type StacksTransaction,
} from "../transactions/types.ts";
import { parseContractId } from "../utils/address.ts";
import { type IntegerType, utf8ToBytes } from "../utils/encoding.ts";

/**
 * The asset an x402 payment moves. Either native STX or a SIP-010 token,
 * in which case the fully-qualified contract id and the fungible-token asset
 * name (the `::<asset-name>` suffix, e.g. `sbtc-token`) are both required —
 * the asset name is not always equal to the contract name.
 */
export type X402Asset =
	| { kind: "stx" }
	| { kind: "sip010"; contractId: string; assetName: string };

export type BuildExactTransferOptions = {
	/** The asset and amount to move. */
	asset: X402Asset;
	amount: IntegerType;
	/** Recipient principal (the resource server's `payTo`). */
	payTo: string;
	/** Origin/payer principal — pinned by the post-condition. */
	payer: string;
	/** Origin compressed public key (the payer signs origin-only). */
	payerPublicKey: string;
	/** The payer account's next nonce. */
	accountNonce: IntegerType;
	/**
	 * The x402 challenge nonce, carried in the on-chain memo so the facilitator
	 * can correlate the settled tx with the challenge. Bound to ≤ 34 bytes
	 * (UTF-8) — both the STX memo and the SIP-010 `(buff 34)` memo arg cap there.
	 */
	nonce: string;
	chain?: StacksChain;
};

/**
 * Build an exact-amount, Deny-mode, post-conditioned, **sponsored** transfer
 * (origin-only, un-broadcast). The origin sets fee `0`; the facilitator's
 * sponsor fills in + pays the fee at settle time. The Deny-mode post-condition
 * asserts EXACTLY `amount` leaves `payer` to `payTo`, so settlement aborts
 * on-chain if anything differs — the "exact amount" x402 guarantee is enforced
 * by Clarity, not just by facilitator simulation.
 */
export function buildExactTransfer(
	options: BuildExactTransferOptions,
): StacksTransaction {
	const { asset, amount, payTo, payer, payerPublicKey, accountNonce, chain } =
		options;

	if (utf8ToBytes(options.nonce).byteLength > MEMO_MAX_LENGTH_BYTES) {
		throw new Error(
			`x402 nonce exceeds the ${MEMO_MAX_LENGTH_BYTES}-byte memo budget`,
		);
	}

	if (asset.kind === "stx") {
		const postConditions: PostCondition[] = [
			Pc.principal(payer).willSendEq(amount).ustx(),
		];
		return buildTokenTransfer({
			recipient: payTo,
			amount,
			memo: options.nonce,
			fee: 0,
			nonce: accountNonce,
			publicKey: payerPublicKey,
			chain,
			postConditionMode: "deny",
			postConditions,
			sponsored: true,
		});
	}

	const [contractAddress, contractName] = parseContractId(asset.contractId);
	const postConditions: PostCondition[] = [
		Pc.principal(payer)
			.willSendEq(amount)
			.ft(asset.contractId, asset.assetName),
	];
	// SIP-010: (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
	return buildContractCall({
		contractAddress,
		contractName,
		functionName: "transfer",
		functionArgs: [
			Cl.uint(amount),
			Cl.principal(payer),
			Cl.principal(payTo),
			Cl.some(Cl.bufferFromUtf8(options.nonce)),
		],
		fee: 0,
		nonce: accountNonce,
		publicKey: payerPublicKey,
		chain,
		postConditionMode: "deny",
		postConditions,
		sponsored: true,
	});
}
