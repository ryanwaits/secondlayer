import type { ClarityValue } from "../clarity/types.ts";

export const AuthType = {
	Standard: 0x04,
	Sponsored: 0x05,
} as const;
export type AuthType = (typeof AuthType)[keyof typeof AuthType];

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

export const ClarityVersion = {
	Clarity1: 1,
	Clarity2: 2,
	Clarity3: 3,
	Clarity4: 4,
	Clarity5: 5,
	Clarity6: 6,
} as const;
export type ClarityVersion =
	(typeof ClarityVersion)[keyof typeof ClarityVersion];

// Anchor mode (deprecated post-Nakamoto, but needed for wire format)
export const AnchorMode = {
	OnChainOnly: 0x01,
	OffChainOnly: 0x02,
	Any: 0x03,
} as const;
export type AnchorMode = (typeof AnchorMode)[keyof typeof AnchorMode];

export const PostConditionModeWire = {
	Allow: 0x01,
	Deny: 0x02,
	Originator: 0x03,
} as const;
export type PostConditionModeWire =
	(typeof PostConditionModeWire)[keyof typeof PostConditionModeWire];

export const AddressHashMode = {
	P2PKH: 0x00,
	P2SH: 0x01,
	P2WPKH: 0x02,
	P2WSH: 0x03,
	P2SH_NonSequential: 0x05,
	P2WSH_P2SH_NonSequential: 0x07,
} as const;
export type AddressHashMode =
	(typeof AddressHashMode)[keyof typeof AddressHashMode];

export const PubKeyEncoding = {
	Compressed: 0x00,
	Uncompressed: 0x01,
} as const;
export type PubKeyEncoding =
	(typeof PubKeyEncoding)[keyof typeof PubKeyEncoding];

export const FungibleConditionCode = {
	Equal: 0x01,
	Greater: 0x02,
	GreaterEqual: 0x03,
	Less: 0x04,
	LessEqual: 0x05,
} as const;

export const NonFungibleConditionCode = {
	Sends: 0x10,
	DoesNotSend: 0x11,
	MaybeSent: 0x12,
} as const;

export const PoxConditionCode = {
	WillNotPerform: 0x30,
	MayPerform: 0x31,
	WillPerform: 0x32,
} as const;
export type PoxConditionCode =
	(typeof PoxConditionCode)[keyof typeof PoxConditionCode];

export const PostConditionPrincipalId = {
	Origin: 0x01,
	Standard: 0x02,
	Contract: 0x03,
} as const;

export const AssetType = {
	STX: 0x00,
	Fungible: 0x01,
	NonFungible: 0x02,
	Staking: 0x03,
	Pox: 0x04,
} as const;

export const AuthFieldType = {
	PublicKeyCompressed: 0x00,
	PublicKeyUncompressed: 0x01,
	SignatureCompressed: 0x02,
	SignatureUncompressed: 0x03,
} as const;

export const RECOVERABLE_ECDSA_SIG_LENGTH_BYTES = 65;
export const MEMO_MAX_LENGTH_BYTES = 34;
export const MAX_STRING_LENGTH_BYTES = 128;
export const COINBASE_BYTES_LENGTH = 32;
export const VRF_PROOF_BYTES_LENGTH = 80;
export const MICROBLOCK_HEADER_BYTES_LENGTH = 132;

export const TenureChangeCause = {
	BlockFound: 0x00,
	Extended: 0x01,
	ExtendedRuntime: 0x02,
	ExtendedReadCount: 0x03,
	ExtendedReadLength: 0x04,
	ExtendedWriteCount: 0x05,
	ExtendedWriteLength: 0x06,
} as const;
export type TenureChangeCause =
	(typeof TenureChangeCause)[keyof typeof TenureChangeCause];

export type TokenTransferPayload = {
	payloadType: typeof PayloadType.TokenTransfer;
	recipient: ClarityValue;
	amount: bigint;
	memo: string;
};

export type ContractCallPayload = {
	payloadType: typeof PayloadType.ContractCall;
	contractAddress: string;
	contractName: string;
	functionName: string;
	functionArgs: ClarityValue[];
};

export type SmartContractPayload = {
	payloadType:
		| typeof PayloadType.SmartContract
		| typeof PayloadType.VersionedSmartContract;
	clarityVersion?: ClarityVersion;
	contractName: string;
	codeBody: string;
};

export type CoinbasePayload = {
	payloadType: typeof PayloadType.Coinbase;
	coinbaseBuffer: string;
};

export type CoinbaseToAltRecipientPayload = {
	payloadType: typeof PayloadType.CoinbaseToAltRecipient;
	coinbaseBuffer: string;
	recipient: ClarityValue;
};

export type PoisonMicroblockPayload = {
	payloadType: typeof PayloadType.PoisonMicroblock;
	header1: string;
	header2: string;
};

export type TenureChangePayload = {
	payloadType: typeof PayloadType.TenureChange;
	tenureConsensusHash: string;
	prevTenureConsensusHash: string;
	burnViewConsensusHash: string;
	previousTenureEnd: string;
	previousTenureBlocks: number;
	cause: TenureChangeCause;
	pubkeyHash: string;
};

export type NakamotoCoinbasePayload = {
	payloadType: typeof PayloadType.NakamotoCoinbase;
	coinbaseBuffer: string;
	recipient: ClarityValue | null;
	vrfProof: string;
};

export type TransactionPayload =
	| TokenTransferPayload
	| ContractCallPayload
	| SmartContractPayload
	| CoinbasePayload
	| CoinbaseToAltRecipientPayload
	| PoisonMicroblockPayload
	| TenureChangePayload
	| NakamotoCoinbasePayload;

export type SingleSigSpendingCondition = {
	hashMode: typeof AddressHashMode.P2PKH | typeof AddressHashMode.P2WPKH;
	signer: string;
	nonce: bigint;
	fee: bigint;
	keyEncoding: PubKeyEncoding;
	signature: string;
};

export type TransactionAuthField = {
	pubKeyEncoding: PubKeyEncoding;
	type: "publicKey" | "signature";
	data: string;
};

export type MultiSigHashMode =
	| typeof AddressHashMode.P2SH
	| typeof AddressHashMode.P2WSH
	| typeof AddressHashMode.P2SH_NonSequential
	| typeof AddressHashMode.P2WSH_P2SH_NonSequential;

export type MultiSigSpendingCondition = {
	hashMode: MultiSigHashMode;
	signer: string;
	nonce: bigint;
	fee: bigint;
	fields: TransactionAuthField[];
	signaturesRequired: number;
};

export type SpendingCondition =
	| SingleSigSpendingCondition
	| MultiSigSpendingCondition;

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

export type StacksTransaction = {
	version: number;
	chainId: number;
	auth: Authorization;
	anchorMode: AnchorMode;
	postConditionMode: PostConditionModeWire;
	postConditions: PostConditionWire[];
	payload: TransactionPayload;
	/** Multi-sig signer metadata — not part of the wire format, preserved
	 *  through serialize/deserialize round-trip for auto-detection. */
	_multisig?: { publicKeys: string[] };
};

export type PostConditionWire =
	| StxPostConditionWire
	| FtPostConditionWire
	| NftPostConditionWire
	| StakingPostConditionWire
	| PoxPostConditionWire;

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

// SIP-045: gates stake/register-for-bond/stake-update; same shape as STX
export type StakingPostConditionWire = {
	type: "staking";
	principal: PostConditionPrincipalWire;
	conditionCode: number;
	amount: bigint;
};

// SIP-045: gates non-locking PoX state changes (unstake, announce-l1-early-exit, …); no amount
export type PoxPostConditionWire = {
	type: "pox";
	principal: PostConditionPrincipalWire;
	conditionCode: PoxConditionCode;
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
