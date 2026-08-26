import type { StacksChain } from "../chains/types.ts";
import type { ClarityValue } from "../clarity/types.ts";
import { Cl } from "../clarity/values.ts";
import { convertPostCondition, fromHex } from "../postconditions/convert.ts";
import type {
	PostConditionInput,
	PostConditionMode,
} from "../postconditions/types.ts";
import { type IntegerType, intToBigInt } from "../utils/encoding.ts";
import {
	createSingleSigSpendingCondition,
	createSponsoredAuth,
	createStandardAuth,
} from "./authorization.ts";
import { createMultiSigSpendingCondition } from "./multisig.ts";
import type { MultiSigHashMode, SpendingCondition } from "./types.ts";
import {
	AnchorMode,
	ClarityVersion,
	PayloadType,
	PostConditionModeWire,
	type StacksTransaction,
} from "./types.ts";

type MultiSigOptions = {
	publicKeys?: string[];
	signaturesRequired?: number;
	hashMode?: MultiSigHashMode;
};

export type BuildTokenTransferOptions = MultiSigOptions & {
	recipient: string;
	amount: IntegerType;
	memo?: string;
	fee: IntegerType;
	nonce: IntegerType;
	publicKey?: string;
	chain?: StacksChain;
	postConditionMode?: PostConditionMode;
	postConditions?: PostConditionInput[];
	sponsored?: boolean;
};

export type BuildContractCallOptions = MultiSigOptions & {
	contractAddress: string;
	contractName: string;
	functionName: string;
	functionArgs: ClarityValue[];
	fee: IntegerType;
	nonce: IntegerType;
	publicKey?: string;
	chain?: StacksChain;
	postConditionMode?: PostConditionMode;
	postConditions?: PostConditionInput[];
	sponsored?: boolean;
};

export type BuildContractDeployOptions = MultiSigOptions & {
	contractName: string;
	codeBody: string;
	clarityVersion?: ClarityVersion;
	fee: IntegerType;
	nonce: IntegerType;
	publicKey?: string;
	chain?: StacksChain;
	postConditionMode?: PostConditionMode;
	postConditions?: PostConditionInput[];
	sponsored?: boolean;
};

function resolvePcMode(mode?: PostConditionMode): PostConditionModeWire {
	if (mode === "allow") return PostConditionModeWire.Allow;
	if (mode === "originator") return PostConditionModeWire.Originator;
	return PostConditionModeWire.Deny;
}

function convertPostConditions(
	pcs?: PostConditionInput[],
): ReturnType<typeof convertPostCondition>[] {
	if (!pcs || pcs.length === 0) return [];
	return pcs.map((pc) =>
		convertPostCondition(typeof pc === "string" ? fromHex(pc) : pc),
	);
}

import type { Authorization } from "./types.ts";

function resolveSpendingCondition(
	opts: MultiSigOptions & { publicKey?: string },
	nonce: bigint,
	fee: bigint,
): SpendingCondition {
	if (opts.publicKeys) {
		return createMultiSigSpendingCondition(
			opts.publicKeys,
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			opts.signaturesRequired!,
			nonce,
			fee,
			opts.hashMode,
		);
	}
	// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
	return createSingleSigSpendingCondition(opts.publicKey!, nonce, fee);
}

function resolveAuth(
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	spendingCondition: any,
	sponsored?: boolean,
): Authorization {
	return sponsored
		? createSponsoredAuth(spendingCondition)
		: createStandardAuth(spendingCondition);
}

function resolveVersionAndChainId(chain?: StacksChain): {
	version: number;
	chainId: number;
} {
	if (!chain) return { version: 0x00, chainId: 0x00000001 }; // mainnet defaults
	return { version: chain.transactionVersion, chainId: chain.id };
}

export function buildTokenTransfer(
	options: BuildTokenTransferOptions,
): StacksTransaction {
	const { version, chainId } = resolveVersionAndChainId(options.chain);
	const fee = intToBigInt(options.fee);
	const nonce = intToBigInt(options.nonce);

	const spendingCondition = resolveSpendingCondition(options, nonce, fee);
	const recipient = Cl.principal(options.recipient);

	const tx: StacksTransaction = {
		version,
		chainId,
		auth: resolveAuth(spendingCondition, options.sponsored),
		anchorMode: AnchorMode.Any,
		postConditionMode: resolvePcMode(options.postConditionMode),
		postConditions: convertPostConditions(options.postConditions),
		payload: {
			payloadType: PayloadType.TokenTransfer,
			recipient,
			amount: intToBigInt(options.amount),
			memo: options.memo ?? "",
		},
	};

	if (options.publicKeys) {
		tx._multisig = { publicKeys: options.publicKeys };
	}
	return tx;
}

export function buildContractCall(
	options: BuildContractCallOptions,
): StacksTransaction {
	const { version, chainId } = resolveVersionAndChainId(options.chain);
	const fee = intToBigInt(options.fee);
	const nonce = intToBigInt(options.nonce);

	const spendingCondition = resolveSpendingCondition(options, nonce, fee);

	const tx: StacksTransaction = {
		version,
		chainId,
		auth: resolveAuth(spendingCondition, options.sponsored),
		anchorMode: AnchorMode.Any,
		postConditionMode: resolvePcMode(options.postConditionMode),
		postConditions: convertPostConditions(options.postConditions),
		payload: {
			payloadType: PayloadType.ContractCall,
			contractAddress: options.contractAddress,
			contractName: options.contractName,
			functionName: options.functionName,
			functionArgs: options.functionArgs,
		},
	};

	if (options.publicKeys) {
		tx._multisig = { publicKeys: options.publicKeys };
	}
	return tx;
}

export function buildContractDeploy(
	options: BuildContractDeployOptions,
): StacksTransaction {
	const { version, chainId } = resolveVersionAndChainId(options.chain);
	const fee = intToBigInt(options.fee);
	const nonce = intToBigInt(options.nonce);

	const spendingCondition = resolveSpendingCondition(options, nonce, fee);
	const clarityVersion = options.clarityVersion ?? ClarityVersion.Clarity4;

	const tx: StacksTransaction = {
		version,
		chainId,
		auth: resolveAuth(spendingCondition, options.sponsored),
		anchorMode: AnchorMode.Any,
		postConditionMode: resolvePcMode(options.postConditionMode),
		postConditions: convertPostConditions(options.postConditions),
		payload: {
			payloadType: PayloadType.VersionedSmartContract,
			clarityVersion,
			contractName: options.contractName,
			codeBody: options.codeBody,
		},
	};

	if (options.publicKeys) {
		tx._multisig = { publicKeys: options.publicKeys };
	}
	return tx;
}
