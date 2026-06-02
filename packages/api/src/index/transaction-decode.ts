import { cvToValue } from "@secondlayer/stacks/clarity";
import {
	AnchorMode,
	AuthType,
	PayloadType,
	PostConditionModeWire,
	deserializeTransaction,
} from "@secondlayer/stacks/transactions";

/** Our transaction taxonomy, collapsing the wire payload variants a consumer
 *  rarely distinguishes (the three coinbase kinds, the two smart-contract
 *  kinds). */
export type TxType =
	| "token_transfer"
	| "contract_call"
	| "smart_contract"
	| "coinbase"
	| "tenure_change"
	| "poison_microblock";

export type DecodedPostCondition =
	| {
			type: "stx";
			principal: string;
			condition_code: number;
			condition_code_name: string | null;
			amount: string;
	  }
	| {
			type: "ft";
			principal: string;
			asset_identifier: string;
			condition_code: number;
			condition_code_name: string | null;
			amount: string;
	  }
	| {
			type: "nft";
			principal: string;
			asset_identifier: string;
			asset_value: unknown;
			condition_code: number;
			condition_code_name: string | null;
	  };

/** Fields decoded from `raw_tx` that the `transactions` table does not persist:
 *  fee/nonce, post-conditions, sponsorship, and the payload specifics for kinds
 *  whose detail isn't already columnar (token_transfer, coinbase, tenure_change,
 *  smart_contract version). contract_call detail comes from the DB row. */
export type DecodedTx = {
	tx_type: TxType;
	fee: string;
	nonce: string;
	sponsored: boolean;
	anchor_mode: "on_chain_only" | "off_chain_only" | "any" | null;
	post_condition_mode: "allow" | "deny" | null;
	post_conditions: DecodedPostCondition[];
	token_transfer?: { recipient: string; amount: string; memo: string };
	smart_contract?: { clarity_version: number | null };
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

const TX_TYPE_BY_PAYLOAD: Record<number, TxType> = {
	[PayloadType.TokenTransfer]: "token_transfer",
	[PayloadType.ContractCall]: "contract_call",
	[PayloadType.SmartContract]: "smart_contract",
	[PayloadType.VersionedSmartContract]: "smart_contract",
	[PayloadType.Coinbase]: "coinbase",
	[PayloadType.CoinbaseToAltRecipient]: "coinbase",
	[PayloadType.NakamotoCoinbase]: "coinbase",
	[PayloadType.TenureChange]: "tenure_change",
	[PayloadType.PoisonMicroblock]: "poison_microblock",
};

const ANCHOR_MODE_NAME: Record<number, DecodedTx["anchor_mode"]> = {
	[AnchorMode.OnChainOnly]: "on_chain_only",
	[AnchorMode.OffChainOnly]: "off_chain_only",
	[AnchorMode.Any]: "any",
};

// Fungible (STX + FT) and non-fungible post-condition codes per SIP-005.
const FUNGIBLE_CONDITION_NAME: Record<number, string> = {
	1: "sent_eq",
	2: "sent_gt",
	3: "sent_ge",
	4: "sent_lt",
	5: "sent_le",
};
const NON_FUNGIBLE_CONDITION_NAME: Record<number, string> = {
	16: "sent",
	17: "not_sent",
};

// biome-ignore lint/suspicious/noExplicitAny: wire principal shape from @secondlayer/stacks
function principalToString(principal: any): string {
	if (principal?.type === "contract") {
		return `${principal.address}.${principal.contractName}`;
	}
	if (principal?.type === "standard") return principal.address;
	return "origin";
}

// biome-ignore lint/suspicious/noExplicitAny: wire asset shape from @secondlayer/stacks
function assetIdentifier(asset: any): string {
	return `${asset.address}.${asset.contractName}::${asset.assetName}`;
}

// biome-ignore lint/suspicious/noExplicitAny: wire post-condition shape from @secondlayer/stacks
function normalizePostCondition(pc: any): DecodedPostCondition | null {
	const principal = principalToString(pc.principal);
	if (pc.type === "stx") {
		return {
			type: "stx",
			principal,
			condition_code: pc.conditionCode,
			condition_code_name: FUNGIBLE_CONDITION_NAME[pc.conditionCode] ?? null,
			amount: String(pc.amount),
		};
	}
	if (pc.type === "ft") {
		return {
			type: "ft",
			principal,
			asset_identifier: assetIdentifier(pc.asset),
			condition_code: pc.conditionCode,
			condition_code_name: FUNGIBLE_CONDITION_NAME[pc.conditionCode] ?? null,
			amount: String(pc.amount),
		};
	}
	if (pc.type === "nft") {
		return {
			type: "nft",
			principal,
			asset_identifier: assetIdentifier(pc.asset),
			asset_value: cvToValue(pc.assetId),
			condition_code: pc.conditionCode,
			condition_code_name:
				NON_FUNGIBLE_CONDITION_NAME[pc.conditionCode] ?? null,
		};
	}
	return null;
}

/** Decode a `raw_tx` hex string into the enrichment fields. Returns null when
 *  the bytes aren't a decodable Stacks transaction — e.g. burnchain-originated
 *  ops the node delivers as `0x00`/`0x` — so callers fall back to the columnar
 *  fields without losing the row. */
export function decodeTransaction(
	rawTx: string | null | undefined,
): DecodedTx | null {
	if (!rawTx || rawTx.length <= 10) return null;
	let tx: ReturnType<typeof deserializeTransaction>;
	try {
		tx = deserializeTransaction(rawTx);
	} catch {
		return null;
	}

	const spending = tx.auth.spendingCondition;
	const payloadType = tx.payload.payloadType;
	const decoded: DecodedTx = {
		tx_type: TX_TYPE_BY_PAYLOAD[payloadType] ?? "smart_contract",
		fee: String(spending.fee),
		nonce: String(spending.nonce),
		sponsored: tx.auth.authType === AuthType.Sponsored,
		anchor_mode: ANCHOR_MODE_NAME[tx.anchorMode] ?? null,
		post_condition_mode:
			tx.postConditionMode === PostConditionModeWire.Allow
				? "allow"
				: tx.postConditionMode === PostConditionModeWire.Deny
					? "deny"
					: null,
		post_conditions: tx.postConditions
			.map(normalizePostCondition)
			.filter((pc): pc is DecodedPostCondition => pc !== null),
	};

	// biome-ignore lint/suspicious/noExplicitAny: payload is a discriminated wire union
	const payload = tx.payload as any;
	if (payloadType === PayloadType.TokenTransfer) {
		decoded.token_transfer = {
			recipient: String(cvToValue(payload.recipient)),
			amount: String(payload.amount),
			memo: payload.memo ?? "",
		};
	} else if (payloadType === PayloadType.VersionedSmartContract) {
		decoded.smart_contract = {
			clarity_version: payload.clarityVersion ?? null,
		};
	} else if (payloadType === PayloadType.SmartContract) {
		decoded.smart_contract = { clarity_version: null };
	} else if (payloadType === PayloadType.CoinbaseToAltRecipient) {
		decoded.coinbase = { alt_recipient: String(cvToValue(payload.recipient)) };
	} else if (payloadType === PayloadType.NakamotoCoinbase) {
		decoded.coinbase = {
			alt_recipient: payload.recipient
				? String(cvToValue(payload.recipient))
				: null,
		};
	} else if (payloadType === PayloadType.TenureChange) {
		decoded.tenure_change = { cause: payload.cause };
	}

	return decoded;
}
