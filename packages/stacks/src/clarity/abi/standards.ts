import type { AbiContract } from "./contract.ts";

export const SIP010_ABI = {
  functions: [
    {
      name: "transfer",
      access: "public",
      args: [
        { name: "amount", type: "uint128" },
        { name: "sender", type: "principal" },
        { name: "recipient", type: "principal" },
        { name: "memo", type: { optional: { buff: { length: 34 } } } },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
    {
      name: "get-balance",
      access: "read-only",
      args: [{ name: "account", type: "principal" }],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-total-supply",
      access: "read-only",
      args: [],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-name",
      access: "read-only",
      args: [],
      outputs: {
        response: {
          ok: { "string-ascii": { length: 32 } },
          error: "uint128",
        },
      },
    },
    {
      name: "get-symbol",
      access: "read-only",
      args: [],
      outputs: {
        response: {
          ok: { "string-ascii": { length: 10 } },
          error: "uint128",
        },
      },
    },
    {
      name: "get-decimals",
      access: "read-only",
      args: [],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-token-uri",
      access: "read-only",
      args: [],
      outputs: {
        response: {
          ok: { optional: { "string-utf8": { length: 256 } } },
          error: "uint128",
        },
      },
    },
  ],
  fungible_tokens: [{ name: "token" }],
} as const satisfies AbiContract;

export const SIP009_ABI = {
  functions: [
    {
      name: "transfer",
      access: "public",
      args: [
        { name: "id", type: "uint128" },
        { name: "sender", type: "principal" },
        { name: "recipient", type: "principal" },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
    {
      name: "get-owner",
      access: "read-only",
      args: [{ name: "id", type: "uint128" }],
      outputs: { response: { ok: { optional: "principal" }, error: "uint128" } },
    },
    {
      name: "get-last-token-id",
      access: "read-only",
      args: [],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-token-uri",
      access: "read-only",
      args: [{ name: "id", type: "uint128" }],
      outputs: {
        response: {
          ok: { optional: { "string-utf8": { length: 256 } } },
          error: "uint128",
        },
      },
    },
  ],
  non_fungible_tokens: [{ name: "nft", type: "uint128" }],
} as const satisfies AbiContract;
