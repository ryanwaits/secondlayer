import {
	FungibleConditionCode,
	NonFungibleConditionCode,
	type PostConditionPrincipalWire,
	type PostConditionWire,
	PoxConditionCode,
} from "../transactions/types.ts";
import { deserializePostConditionWire } from "../transactions/wire/deserialize.ts";
import { serializePostConditionWire } from "../transactions/wire/serialize.ts";
import { parseContractId } from "../utils/address.ts";
import {
	type IntegerType,
	bytesToHex,
	intToBigInt,
} from "../utils/encoding.ts";
import type {
	FungibleComparator,
	NonFungibleComparator,
	PostCondition,
	PoxComparator,
} from "./types.ts";

const MAX_U64 = 18446744073709551615n; // 2^64 - 1

/** Parse a PC amount; throw if outside the u64 the wire can carry. */
export function parsePostConditionAmount(amount: IntegerType): bigint {
	const value = intToBigInt(amount);
	if (value < 0n || value > MAX_U64) {
		throw new RangeError(
			`Post-condition amount must be between 0 and ${MAX_U64} (u64 max), received: ${value}`,
		);
	}
	return value;
}

export const FUNGIBLE_CODE_MAP: Record<FungibleComparator, number> = {
	eq: FungibleConditionCode.Equal,
	gt: FungibleConditionCode.Greater,
	gte: FungibleConditionCode.GreaterEqual,
	lt: FungibleConditionCode.Less,
	lte: FungibleConditionCode.LessEqual,
};

const FUNGIBLE_CODE_REVERSE: Record<number, FungibleComparator> = {
	[FungibleConditionCode.Equal]: "eq",
	[FungibleConditionCode.Greater]: "gt",
	[FungibleConditionCode.GreaterEqual]: "gte",
	[FungibleConditionCode.Less]: "lt",
	[FungibleConditionCode.LessEqual]: "lte",
};

export const NFT_CODE_MAP: Record<NonFungibleComparator, number> = {
	sent: NonFungibleConditionCode.Sends,
	"not-sent": NonFungibleConditionCode.DoesNotSend,
	"maybe-sent": NonFungibleConditionCode.MaybeSent,
};

const NFT_CODE_REVERSE: Record<number, NonFungibleComparator> = {
	[NonFungibleConditionCode.Sends]: "sent",
	[NonFungibleConditionCode.DoesNotSend]: "not-sent",
	[NonFungibleConditionCode.MaybeSent]: "maybe-sent",
};

export const POX_CODE_MAP: Record<PoxComparator, PoxConditionCode> = {
	"will-not-perform": PoxConditionCode.WillNotPerform,
	"may-perform": PoxConditionCode.MayPerform,
	"will-perform": PoxConditionCode.WillPerform,
};

const POX_CODE_REVERSE: Record<number, PoxComparator> = {
	[PoxConditionCode.WillNotPerform]: "will-not-perform",
	[PoxConditionCode.MayPerform]: "may-perform",
	[PoxConditionCode.WillPerform]: "will-perform",
};

export function resolvePrincipal(address: string): PostConditionPrincipalWire {
	if (address === "origin") return { type: "origin" };
	const [addr, name] = address.split(".");
	if (name) {
		// biome-ignore lint/style/noNonNullAssertion: split yields address when name is present
		return { type: "contract", address: addr!, contractName: name };
	}
	// biome-ignore lint/style/noNonNullAssertion: address is the whole string
	return { type: "standard", address: addr! };
}

function principalToString(principal: PostConditionPrincipalWire): string {
	if (principal.type === "origin") return "origin";
	if (principal.type === "contract") {
		return `${principal.address}.${principal.contractName}`;
	}
	return principal.address;
}

function assetToString(asset: {
	address: string;
	contractName: string;
	assetName: string;
}): string {
	return `${asset.address}.${asset.contractName}::${asset.assetName}`;
}

function parseAsset(asset: string): {
	address: string;
	contractName: string;
	assetName: string;
} {
	const [contractId, tokenName] = asset.split("::");
	// biome-ignore lint/style/noNonNullAssertion: callers validate `::` form
	const [addr, name] = parseContractId(contractId!);
	// biome-ignore lint/style/noNonNullAssertion: split of `addr.contract::token`
	return { address: addr, contractName: name, assetName: tokenName! };
}

export function convertPostCondition(pc: PostCondition): PostConditionWire {
	switch (pc.type) {
		case "stx-postcondition":
			return {
				type: "stx",
				principal: resolvePrincipal(pc.address),
				conditionCode: FUNGIBLE_CODE_MAP[pc.condition],
				amount: parsePostConditionAmount(pc.amount),
			};
		case "ft-postcondition":
			return {
				type: "ft",
				principal: resolvePrincipal(pc.address),
				asset: parseAsset(pc.asset),
				conditionCode: FUNGIBLE_CODE_MAP[pc.condition],
				amount: parsePostConditionAmount(pc.amount),
			};
		case "nft-postcondition":
			return {
				type: "nft",
				principal: resolvePrincipal(pc.address),
				asset: parseAsset(pc.asset),
				conditionCode: NFT_CODE_MAP[pc.condition],
				assetId: pc.assetId,
			};
		case "staking-postcondition":
			return {
				type: "staking",
				principal: resolvePrincipal(pc.address),
				conditionCode: FUNGIBLE_CODE_MAP[pc.condition],
				amount: parsePostConditionAmount(pc.amount),
			};
		case "pox-postcondition":
			return {
				type: "pox",
				principal: resolvePrincipal(pc.address),
				conditionCode: POX_CODE_MAP[pc.condition],
			};
	}
}

export function wireToPostCondition(wire: PostConditionWire): PostCondition {
	switch (wire.type) {
		case "stx":
			return {
				type: "stx-postcondition",
				address: principalToString(wire.principal),
				condition: fungibleName(wire.conditionCode),
				amount: wire.amount.toString(),
			};
		case "ft":
			return {
				type: "ft-postcondition",
				address: principalToString(wire.principal),
				condition: fungibleName(wire.conditionCode),
				amount: wire.amount.toString(),
				asset: assetToString(wire.asset),
			};
		case "nft":
			return {
				type: "nft-postcondition",
				address: principalToString(wire.principal),
				condition: nftName(wire.conditionCode),
				asset: assetToString(wire.asset),
				assetId: wire.assetId,
			};
		case "staking":
			return {
				type: "staking-postcondition",
				address: principalToString(wire.principal),
				condition: fungibleName(wire.conditionCode),
				amount: wire.amount.toString(),
			};
		case "pox":
			return {
				type: "pox-postcondition",
				address: principalToString(wire.principal),
				condition: poxName(wire.conditionCode),
			};
	}
}

function fungibleName(code: number): FungibleComparator {
	const name = FUNGIBLE_CODE_REVERSE[code];
	if (!name) throw new Error(`Unknown fungible post-condition code: ${code}`);
	return name;
}

function nftName(code: number): NonFungibleComparator {
	const name = NFT_CODE_REVERSE[code];
	if (!name) throw new Error(`Unknown nft post-condition code: ${code}`);
	return name;
}

function poxName(code: number): PoxComparator {
	const name = POX_CODE_REVERSE[code];
	if (!name) throw new Error(`Unknown pox post-condition code: ${code}`);
	return name;
}

/** Decode a serialized post-condition (stacks.js `Pc.fromHex`). */
export function fromHex(hex: string): PostCondition {
	return wireToPostCondition(deserializePostConditionWire(hex));
}

/** Encode a post-condition to hex (stacks.js `postConditionToHex`). */
export function postConditionToHex(pc: PostCondition): string {
	return bytesToHex(serializePostConditionWire(convertPostCondition(pc)));
}
