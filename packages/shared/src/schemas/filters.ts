import { z } from "zod";
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

// Type exports
export type StxTransferFilter = z.infer<typeof StxTransferFilterSchema>;
export type StxMintFilter = z.infer<typeof StxMintFilterSchema>;
export type StxBurnFilter = z.infer<typeof StxBurnFilterSchema>;
export type StxLockFilter = z.infer<typeof StxLockFilterSchema>;
export type FtTransferFilter = z.infer<typeof FtTransferFilterSchema>;
export type FtMintFilter = z.infer<typeof FtMintFilterSchema>;
export type FtBurnFilter = z.infer<typeof FtBurnFilterSchema>;
export type NftTransferFilter = z.infer<typeof NftTransferFilterSchema>;
export type NftMintFilter = z.infer<typeof NftMintFilterSchema>;
export type NftBurnFilter = z.infer<typeof NftBurnFilterSchema>;
export type ContractCallFilter = z.infer<typeof ContractCallFilterSchema>;
export type ContractDeployFilter = z.infer<typeof ContractDeployFilterSchema>;
export type PrintEventFilter = z.infer<typeof PrintEventFilterSchema>;
export type StreamFilter = z.infer<typeof StreamFilterSchema>;
