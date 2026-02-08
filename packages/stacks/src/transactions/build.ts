import type { StacksChain } from "../chains/types.ts";
import type { ClarityValue } from "../clarity/types.ts";
import type { PostCondition } from "../postconditions/types.ts";
import type { MultiSigHashMode, SpendingCondition } from "./types.ts";
import {
  createSingleSigSpendingCondition,
  createStandardAuth,
  createSponsoredAuth,
} from "./authorization.ts";
import { createMultiSigSpendingCondition } from "./multisig.ts";
import {
  PayloadType,
  AnchorMode,
  PostConditionModeWire,
  FungibleConditionCode,
  NonFungibleConditionCode,
  PostConditionPrincipalId,
  type StacksTransaction,
  type PostConditionWire,
  type PostConditionPrincipalWire,
  type ClarityVersion,
} from "./types.ts";
import { Cl } from "../clarity/values.ts";
import { intToBigInt, type IntegerType } from "../utils/encoding.ts";
import { validateStacksAddress, parseContractId } from "../utils/address.ts";

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
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
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
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
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
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
  sponsored?: boolean;
};

function resolvePcMode(mode?: "allow" | "deny"): PostConditionModeWire {
  return mode === "allow" ? PostConditionModeWire.Allow : PostConditionModeWire.Deny;
}

function convertPostConditions(pcs?: PostCondition[]): PostConditionWire[] {
  if (!pcs || pcs.length === 0) return [];
  return pcs.map(convertPostCondition);
}

function resolvePrincipal(address: string): PostConditionPrincipalWire {
  if (address === "origin") return { type: "origin" };
  const [addr, name] = address.split(".");
  if (name) {
    return { type: "contract", address: addr!, contractName: name };
  }
  return { type: "standard", address: addr! };
}

const FUNGIBLE_CODE_MAP: Record<string, number> = {
  eq: FungibleConditionCode.Equal,
  gt: FungibleConditionCode.Greater,
  gte: FungibleConditionCode.GreaterEqual,
  lt: FungibleConditionCode.Less,
  lte: FungibleConditionCode.LessEqual,
};

function convertPostCondition(pc: PostCondition): PostConditionWire {
  switch (pc.type) {
    case "stx-postcondition":
      return {
        type: "stx",
        principal: resolvePrincipal(pc.address),
        conditionCode: FUNGIBLE_CODE_MAP[pc.condition]!,
        amount: intToBigInt(pc.amount),
      };
    case "ft-postcondition": {
      const [contractId, tokenName] = pc.asset.split("::");
      const [addr, name] = parseContractId(contractId!);
      return {
        type: "ft",
        principal: resolvePrincipal(pc.address),
        asset: { address: addr, contractName: name, assetName: tokenName! },
        conditionCode: FUNGIBLE_CODE_MAP[pc.condition]!,
        amount: intToBigInt(pc.amount),
      };
    }
    case "nft-postcondition": {
      const [contractId, tokenName] = pc.asset.split("::");
      const [addr, name] = parseContractId(contractId!);
      return {
        type: "nft",
        principal: resolvePrincipal(pc.address),
        asset: { address: addr, contractName: name, assetName: tokenName! },
        conditionCode: pc.condition === "sent" ? NonFungibleConditionCode.Sends : NonFungibleConditionCode.DoesNotSend,
        assetId: pc.assetId,
      };
    }
  }
}

import type { Authorization } from "./types.ts";

function resolveSpendingCondition(
  opts: MultiSigOptions & { publicKey?: string },
  nonce: bigint,
  fee: bigint
): SpendingCondition {
  if (opts.publicKeys) {
    return createMultiSigSpendingCondition(
      opts.publicKeys,
      opts.signaturesRequired!,
      nonce,
      fee,
      opts.hashMode
    );
  }
  return createSingleSigSpendingCondition(opts.publicKey!, nonce, fee);
}

function resolveAuth(spendingCondition: any, sponsored?: boolean): Authorization {
  return sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);
}

function resolveVersionAndChainId(chain?: StacksChain): { version: number; chainId: number } {
  if (!chain) return { version: 0x00, chainId: 0x00000001 }; // mainnet defaults
  return { version: chain.transactionVersion, chainId: chain.id };
}

export function buildTokenTransfer(options: BuildTokenTransferOptions): StacksTransaction {
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
    (tx as any)._multisig = { publicKeys: options.publicKeys };
  }
  return tx;
}

export function buildContractCall(options: BuildContractCallOptions): StacksTransaction {
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
    (tx as any)._multisig = { publicKeys: options.publicKeys };
  }
  return tx;
}

export function buildContractDeploy(options: BuildContractDeployOptions): StacksTransaction {
  const { version, chainId } = resolveVersionAndChainId(options.chain);
  const fee = intToBigInt(options.fee);
  const nonce = intToBigInt(options.nonce);

  const spendingCondition = resolveSpendingCondition(options, nonce, fee);
  const useVersioned = options.clarityVersion !== undefined;

  const tx: StacksTransaction = {
    version,
    chainId,
    auth: resolveAuth(spendingCondition, options.sponsored),
    anchorMode: AnchorMode.Any,
    postConditionMode: resolvePcMode(options.postConditionMode),
    postConditions: convertPostConditions(options.postConditions),
    payload: {
      payloadType: useVersioned ? PayloadType.VersionedSmartContract : PayloadType.SmartContract,
      clarityVersion: options.clarityVersion,
      contractName: options.contractName,
      codeBody: options.codeBody,
    },
  };

  if (options.publicKeys) {
    (tx as any)._multisig = { publicKeys: options.publicKeys };
  }
  return tx;
}
