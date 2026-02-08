import type { AbiContract } from "../clarity/abi/contract.ts";

const withdrawTuple = {
  tuple: [
    { name: "stx-fee-amount", type: "uint128" },
    { name: "stx-user-amount", type: "uint128" },
  ],
} as const;

export const STACKING_DAO_CORE_ABI = {
  functions: [
    // Public — deposit STX, receive stSTX
    {
      name: "deposit",
      access: "public",
      args: [
        { name: "reserve", type: "trait_reference" },
        { name: "commission-contract", type: "trait_reference" },
        { name: "staking-contract", type: "trait_reference" },
        { name: "direct-helpers", type: "trait_reference" },
        { name: "stx-amount", type: "uint128" },
        { name: "referrer", type: { optional: "principal" } },
        { name: "pool", type: { optional: "principal" } },
      ],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    // Public — initiate withdrawal (burn stSTX, get NFT receipt)
    {
      name: "init-withdraw",
      access: "public",
      args: [
        { name: "reserve", type: "trait_reference" },
        { name: "direct-helpers", type: "trait_reference" },
        { name: "ststx-amount", type: "uint128" },
      ],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    // Public — finalize withdrawal (burn NFT, receive STX)
    {
      name: "withdraw",
      access: "public",
      args: [
        { name: "reserve", type: "trait_reference" },
        { name: "commission-contract", type: "trait_reference" },
        { name: "staking-contract", type: "trait_reference" },
        { name: "nft-id", type: "uint128" },
      ],
      outputs: { response: { ok: withdrawTuple, error: "uint128" } },
    },
    // Public — withdraw idle STX (instant, no NFT)
    {
      name: "withdraw-idle",
      access: "public",
      args: [
        { name: "reserve", type: "trait_reference" },
        { name: "direct-helpers", type: "trait_reference" },
        { name: "commission-contract", type: "trait_reference" },
        { name: "staking-contract", type: "trait_reference" },
        { name: "ststx-amount", type: "uint128" },
      ],
      outputs: { response: { ok: withdrawTuple, error: "uint128" } },
    },
    // Read-only — fees (direct values, no response wrapper)
    {
      name: "get-stack-fee",
      access: "read-only",
      args: [],
      outputs: "uint128",
    },
    {
      name: "get-unstack-fee",
      access: "read-only",
      args: [],
      outputs: "uint128",
    },
    {
      name: "get-withdraw-idle-fee",
      access: "read-only",
      args: [],
      outputs: "uint128",
    },
    // Read-only — shutdown state (direct bool, no response wrapper)
    {
      name: "get-shutdown-deposits",
      access: "read-only",
      args: [],
      outputs: "bool",
    },
  ],
} as const satisfies AbiContract;

export const DATA_CORE_V1_ABI = {
  functions: [
    {
      name: "get-withdrawals-by-nft",
      access: "read-only",
      args: [{ name: "nft-id", type: "uint128" }],
      outputs: {
        tuple: [
          { name: "ststx-amount", type: "uint128" },
          { name: "stx-amount", type: "uint128" },
          { name: "unlock-burn-height", type: "uint128" },
        ],
      },
    },
  ],
} as const satisfies AbiContract;

export const DATA_CORE_V3_ABI = {
  functions: [
    {
      name: "get-stx-per-ststx-helper",
      access: "read-only",
      args: [{ name: "stx-amount", type: "uint128" }],
      outputs: "uint128",
    },
  ],
} as const satisfies AbiContract;

export const RESERVE_V1_ABI = {
  functions: [
    {
      name: "get-total-stx",
      access: "read-only",
      args: [],
      outputs: { response: { ok: "uint128", error: "none" } },
    },
  ],
} as const satisfies AbiContract;
