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

export type PostCondition = StxPostCondition | FtPostCondition | NftPostCondition;

export type PostConditionMode = "allow" | "deny";
