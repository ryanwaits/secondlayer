import { z } from "zod/v4";
import { isValidAddress as _isValidAddress } from "@secondlayer/stacks";

const isValidAddress = _isValidAddress as (addr: string) => boolean;

/** Validate a Stacks principal (standard or contract, e.g. SP2J...ABC or SP2J...ABC.contract-name) */
const stacksPrincipal = z.string().refine((val) => {
  const parts = val.split(".");
  if (parts.length > 2) return false;
  return isValidAddress(parts[0]!);
}, "Invalid Stacks principal address");

// Base filter with common fields
const baseFilter = {
  // Optional: filter by sender
  sender: stacksPrincipal.optional(),
  // Optional: filter by recipient
  recipient: stacksPrincipal.optional(),
};

// Type exports — defined first so they can annotate schemas
export interface StxTransferFilter {
  type: "stx_transfer";
  sender?: string;
  recipient?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface StxMintFilter {
  type: "stx_mint";
  recipient?: string;
  minAmount?: number;
}

export interface StxBurnFilter {
  type: "stx_burn";
  sender?: string;
  minAmount?: number;
}

export interface StxLockFilter {
  type: "stx_lock";
  lockedAddress?: string;
  minAmount?: number;
}

export interface FtTransferFilter {
  type: "ft_transfer";
  sender?: string;
  recipient?: string;
  assetIdentifier?: string;
  minAmount?: number;
}

export interface FtMintFilter {
  type: "ft_mint";
  recipient?: string;
  assetIdentifier?: string;
  minAmount?: number;
}

export interface FtBurnFilter {
  type: "ft_burn";
  sender?: string;
  assetIdentifier?: string;
  minAmount?: number;
}

export interface NftTransferFilter {
  type: "nft_transfer";
  sender?: string;
  recipient?: string;
  assetIdentifier?: string;
  tokenId?: string;
}

export interface NftMintFilter {
  type: "nft_mint";
  recipient?: string;
  assetIdentifier?: string;
  tokenId?: string;
}

export interface NftBurnFilter {
  type: "nft_burn";
  sender?: string;
  assetIdentifier?: string;
  tokenId?: string;
}

export interface ContractCallFilter {
  type: "contract_call";
  contractId?: string;
  functionName?: string;
  caller?: string;
}

export interface ContractDeployFilter {
  type: "contract_deploy";
  deployer?: string;
  contractName?: string;
}

export interface PrintEventFilter {
  type: "print_event";
  contractId?: string;
  topic?: string;
  contains?: string;
}

export type StreamFilter =
  | StxTransferFilter
  | StxMintFilter
  | StxBurnFilter
  | StxLockFilter
  | FtTransferFilter
  | FtMintFilter
  | FtBurnFilter
  | NftTransferFilter
  | NftMintFilter
  | NftBurnFilter
  | ContractCallFilter
  | ContractDeployFilter
  | PrintEventFilter;

// STX Transfer Filter
export const StxTransferFilterSchema = z.object({
  type: z.literal("stx_transfer"),
  ...baseFilter,
  // Optional: minimum amount in microSTX
  minAmount: z.coerce.number().int().positive().optional(),
  // Optional: maximum amount in microSTX
  maxAmount: z.coerce.number().int().positive().optional(),
});

// STX Mint Filter
export const StxMintFilterSchema = z.object({
  type: z.literal("stx_mint"),
  recipient: stacksPrincipal.optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// STX Burn Filter
export const StxBurnFilterSchema = z.object({
  type: z.literal("stx_burn"),
  sender: stacksPrincipal.optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// STX Lock Filter
export const StxLockFilterSchema = z.object({
  type: z.literal("stx_lock"),
  lockedAddress: stacksPrincipal.optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// FT Transfer Filter
export const FtTransferFilterSchema = z.object({
  type: z.literal("ft_transfer"),
  ...baseFilter,
  // Contract that defines the token (e.g., SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wstx)
  assetIdentifier: z.string().optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// FT Mint Filter
export const FtMintFilterSchema = z.object({
  type: z.literal("ft_mint"),
  recipient: stacksPrincipal.optional(),
  assetIdentifier: z.string().optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// FT Burn Filter
export const FtBurnFilterSchema = z.object({
  type: z.literal("ft_burn"),
  sender: stacksPrincipal.optional(),
  assetIdentifier: z.string().optional(),
  minAmount: z.coerce.number().int().positive().optional(),
});

// NFT Transfer Filter
export const NftTransferFilterSchema = z.object({
  type: z.literal("nft_transfer"),
  ...baseFilter,
  assetIdentifier: z.string().optional(),
  // Optional: filter by specific token ID (Clarity value as hex)
  tokenId: z.string().optional(),
});

// NFT Mint Filter
export const NftMintFilterSchema = z.object({
  type: z.literal("nft_mint"),
  recipient: stacksPrincipal.optional(),
  assetIdentifier: z.string().optional(),
  tokenId: z.string().optional(),
});

// NFT Burn Filter
export const NftBurnFilterSchema = z.object({
  type: z.literal("nft_burn"),
  sender: stacksPrincipal.optional(),
  assetIdentifier: z.string().optional(),
  tokenId: z.string().optional(),
});

// Contract Call Filter
export const ContractCallFilterSchema = z.object({
  type: z.literal("contract_call"),
  // Contract being called
  contractId: stacksPrincipal.optional(),
  // Function name (supports wildcards with *)
  functionName: z.string().optional(),
  // Caller address
  caller: stacksPrincipal.optional(),
});

// Contract Deploy Filter
export const ContractDeployFilterSchema = z.object({
  type: z.literal("contract_deploy"),
  // Deployer address
  deployer: stacksPrincipal.optional(),
  // Contract name pattern (supports wildcards)
  contractName: z.string().optional(),
});

// Print Event Filter (smart contract events)
export const PrintEventFilterSchema = z.object({
  type: z.literal("print_event"),
  // Contract emitting the event
  contractId: stacksPrincipal.optional(),
  // Topic/name of the event
  topic: z.string().optional(),
  // Search for substring in event data
  contains: z.string().optional(),
});

// Union of all filter types
export const StreamFilterSchema = z.discriminatedUnion("type", [
  StxTransferFilterSchema,
  StxMintFilterSchema,
  StxBurnFilterSchema,
  StxLockFilterSchema,
  FtTransferFilterSchema,
  FtMintFilterSchema,
  FtBurnFilterSchema,
  NftTransferFilterSchema,
  NftMintFilterSchema,
  NftBurnFilterSchema,
  ContractCallFilterSchema,
  ContractDeployFilterSchema,
  PrintEventFilterSchema,
]);
