import type { ClarityValue } from "../clarity/types.ts";

export type FungibleComparator = "eq" | "gt" | "gte" | "lt" | "lte";
export type NonFungibleComparator = "sent" | "not-sent";

export type StxPostCondition = {
	type: "stx-postcondition";
	address: string;
	condition: FungibleComparator;
	amount: string | bigint | number;
};

export type FtPostCondition = {
	type: "ft-postcondition";
	address: string;
	condition: FungibleComparator;
	asset: string; // "address.contract::token-name"
	amount: string | bigint | number;
};

export type NftPostCondition = {
	type: "nft-postcondition";
	address: string;
	condition: NonFungibleComparator;
	asset: string; // "address.contract::token-name"
	assetId: ClarityValue;
};

// SIP-045: gates stake/register-for-bond/stake-update calls
export type StakingPostCondition = {
	type: "staking-postcondition";
	address: string;
	condition: FungibleComparator;
	amount: string | bigint | number;
};

export type PoxComparator = "will-not-perform" | "may-perform" | "will-perform";

// SIP-045: gates non-locking PoX state changes (unstake, announce-l1-early-exit, …)
export type PoxPostCondition = {
	type: "pox-postcondition";
	address: string;
	condition: PoxComparator;
};

export type PostCondition =
	| StxPostCondition
	| FtPostCondition
	| NftPostCondition
	| StakingPostCondition
	| PoxPostCondition;

export type PostConditionMode = "allow" | "deny";
