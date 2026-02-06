import type { ClarityValue } from "../clarity/types.ts";

// Auth types
export const AuthType = {
  Standard: 0x04,
  Sponsored: 0x05,
} as const;
export type AuthType = (typeof AuthType)[keyof typeof AuthType];

// Payload types
export const PayloadType = {
  TokenTransfer: 0x00,
  SmartContract: 0x01,
  ContractCall: 0x02,
  PoisonMicroblock: 0x03,
  Coinbase: 0x04,
  CoinbaseToAltRecipient: 0x05,
  VersionedSmartContract: 0x06,
  TenureChange: 0x07,
  NakamotoCoinbase: 0x08,
} as const;
export type PayloadType = (typeof PayloadType)[keyof typeof PayloadType];

// Clarity version
export const ClarityVersion = {
  Clarity1: 1,
  Clarity2: 2,
  Clarity3: 3,
} as const;
export type ClarityVersion = (typeof ClarityVersion)[keyof typeof ClarityVersion];

// Anchor mode (deprecated post-Nakamoto, but needed for wire format)
export const AnchorMode = {
  OnChainOnly: 0x01,
  OffChainOnly: 0x02,
  Any: 0x03,
} as const;
export type AnchorMode = (typeof AnchorMode)[keyof typeof AnchorMode];

// Post condition mode
export const PostConditionModeWire = {
  Allow: 0x01,
  Deny: 0x02,
} as const;
export type PostConditionModeWire =
  (typeof PostConditionModeWire)[keyof typeof PostConditionModeWire];

// Address hash modes
export const AddressHashMode = {
  P2PKH: 0x00,
  P2SH: 0x01,
  P2WPKH: 0x02,
  P2WSH: 0x03,
} as const;
export type AddressHashMode = (typeof AddressHashMode)[keyof typeof AddressHashMode];

// Pub key encoding
export const PubKeyEncoding = {
  Compressed: 0x00,
  Uncompressed: 0x01,
} as const;
export type PubKeyEncoding = (typeof PubKeyEncoding)[keyof typeof PubKeyEncoding];

// Fungible condition codes (wire format)
export const FungibleConditionCode = {
  Equal: 0x01,
  Greater: 0x02,
  GreaterEqual: 0x03,
  Less: 0x04,
  LessEqual: 0x05,
} as const;

// Non-fungible condition codes (wire format)
export const NonFungibleConditionCode = {
  Sends: 0x10,
  DoesNotSend: 0x11,
} as const;

// Post condition principal types
export const PostConditionPrincipalId = {
  Origin: 0x01,
  Standard: 0x02,
  Contract: 0x03,
} as const;

// Post condition asset types
export const AssetType = {
  STX: 0x00,
  Fungible: 0x01,
  NonFungible: 0x02,
} as const;

// Auth field types
export const AuthFieldType = {
  PublicKeyCompressed: 0x00,
  PublicKeyUncompressed: 0x01,
  SignatureCompressed: 0x02,
  SignatureUncompressed: 0x03,
} as const;

export const RECOVERABLE_ECDSA_SIG_LENGTH_BYTES = 65;
export const MEMO_MAX_LENGTH_BYTES = 34;
export const MAX_STRING_LENGTH_BYTES = 128;

// Token transfer payload
export type TokenTransferPayload = {
  payloadType: typeof PayloadType.TokenTransfer;
  recipient: ClarityValue; // PrincipalCV
  amount: bigint;
  memo: string;
};

// Contract call payload
export type ContractCallPayload = {
  payloadType: typeof PayloadType.ContractCall;
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
};

// Smart contract deploy payload
export type SmartContractPayload = {
  payloadType: typeof PayloadType.SmartContract | typeof PayloadType.VersionedSmartContract;
  clarityVersion?: ClarityVersion;
  contractName: string;
  codeBody: string;
};

export type TransactionPayload =
  | TokenTransferPayload
  | ContractCallPayload
  | SmartContractPayload;

// Spending condition
export type SingleSigSpendingCondition = {
  hashMode: typeof AddressHashMode.P2PKH | typeof AddressHashMode.P2WPKH;
  signer: string; // hash160 hex
  nonce: bigint;
  fee: bigint;
  keyEncoding: PubKeyEncoding;
  signature: string; // 65-byte recoverable sig hex
};

export type TransactionAuthField = {
  pubKeyEncoding: PubKeyEncoding;
  type: "publicKey" | "signature";
  data: string; // hex
};

export type MultiSigSpendingCondition = {
  hashMode: typeof AddressHashMode.P2SH | typeof AddressHashMode.P2WSH;
  signer: string;
  nonce: bigint;
  fee: bigint;
  fields: TransactionAuthField[];
  signaturesRequired: number;
};

export type SpendingCondition = SingleSigSpendingCondition | MultiSigSpendingCondition;

export type StandardAuthorization = {
  authType: typeof AuthType.Standard;
  spendingCondition: SpendingCondition;
};

export type SponsoredAuthorization = {
  authType: typeof AuthType.Sponsored;
  spendingCondition: SpendingCondition;
  sponsorSpendingCondition: SpendingCondition;
};

export type Authorization = StandardAuthorization | SponsoredAuthorization;

// Full transaction
export type StacksTransaction = {
  version: number;
  chainId: number;
  auth: Authorization;
  anchorMode: AnchorMode;
  postConditionMode: PostConditionModeWire;
  postConditions: PostConditionWire[];
  payload: TransactionPayload;
};

// Wire post condition types
export type PostConditionWire = StxPostConditionWire | FtPostConditionWire | NftPostConditionWire;

export type StxPostConditionWire = {
  type: "stx";
  principal: PostConditionPrincipalWire;
  conditionCode: number;
  amount: bigint;
};

export type FtPostConditionWire = {
  type: "ft";
  principal: PostConditionPrincipalWire;
  asset: AssetInfoWire;
  conditionCode: number;
  amount: bigint;
};

export type NftPostConditionWire = {
  type: "nft";
  principal: PostConditionPrincipalWire;
  asset: AssetInfoWire;
  conditionCode: number;
  assetId: ClarityValue;
};

export type PostConditionPrincipalWire =
  | { type: "origin" }
  | { type: "standard"; address: string }
  | { type: "contract"; address: string; contractName: string };

export type AssetInfoWire = {
  address: string;
  contractName: string;
  assetName: string;
};
