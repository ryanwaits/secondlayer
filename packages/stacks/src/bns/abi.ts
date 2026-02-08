import type { AbiContract } from "../clarity/abi/contract.ts";

export const BNS_ABI = {
  functions: [
    // Name resolution (read-only)
    {
      name: "get-owner-name",
      access: "read-only",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
      ],
      outputs: {
        response: {
          ok: { optional: "principal" },
          error: "uint128",
        },
      },
    },
    {
      name: "get-id-from-bns",
      access: "read-only",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
      ],
      outputs: { optional: "uint128" },
    },
    {
      name: "get-bns-from-id",
      access: "read-only",
      args: [{ name: "id", type: "uint128" }],
      outputs: {
        optional: {
          tuple: [
            { name: "name", type: { buff: { length: 48 } } },
            { name: "namespace", type: { buff: { length: 20 } } },
          ],
        },
      },
    },
    {
      name: "get-owner",
      access: "read-only",
      args: [{ name: "id", type: "uint128" }],
      outputs: {
        response: {
          ok: { optional: "principal" },
          error: "none",
        },
      },
    },
    {
      name: "get-primary",
      access: "read-only",
      args: [{ name: "owner", type: "principal" }],
      outputs: {
        response: {
          ok: {
            optional: {
              tuple: [
                { name: "name", type: { buff: { length: 48 } } },
                { name: "namespace", type: { buff: { length: 20 } } },
              ],
            },
          },
          error: "none",
        },
      },
    },
    {
      name: "can-resolve-name",
      access: "read-only",
      args: [
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "name", type: { buff: { length: 48 } } },
      ],
      outputs: {
        response: {
          ok: {
            tuple: [
              { name: "renewal", type: "uint128" },
              { name: "owner", type: "principal" },
            ],
          },
          error: "uint128",
        },
      },
    },
    {
      name: "get-renewal-height",
      access: "read-only",
      args: [{ name: "id", type: "uint128" }],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-name-price",
      access: "read-only",
      args: [
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "name", type: { buff: { length: 48 } } },
      ],
      outputs: {
        response: {
          ok: { response: { ok: "uint128", error: "uint128" } },
          error: "uint128",
        },
      },
    },
    {
      name: "get-bns-info",
      access: "read-only",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
      ],
      outputs: {
        optional: {
          tuple: [
            { name: "hashed-salted-fqn-preorder", type: { optional: { buff: { length: 20 } } } },
            { name: "imported-at", type: { optional: "uint128" } },
            { name: "owner", type: "principal" },
            { name: "preordered-by", type: { optional: "principal" } },
            { name: "registered-at", type: { optional: "uint128" } },
            { name: "renewal-height", type: "uint128" },
            { name: "stx-burn", type: "uint128" },
          ],
        },
      },
    },

    // Name registration (public)
    {
      name: "name-preorder",
      access: "public",
      args: [
        { name: "hashed-salted-fqn", type: { buff: { length: 20 } } },
        { name: "stx-to-burn", type: "uint128" },
      ],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "name-register",
      access: "public",
      args: [
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "name", type: { buff: { length: 48 } } },
        { name: "salt", type: { buff: { length: 20 } } },
      ],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "name-claim-fast",
      access: "public",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "send-to", type: "principal" },
      ],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "name-renewal",
      access: "public",
      args: [
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "name", type: { buff: { length: 48 } } },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },

    // Name management (public)
    {
      name: "transfer",
      access: "public",
      args: [
        { name: "id", type: "uint128" },
        { name: "owner", type: "principal" },
        { name: "recipient", type: "principal" },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
    {
      name: "set-primary-name",
      access: "public",
      args: [{ name: "primary-name-id", type: "uint128" }],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
  ],
  non_fungible_tokens: [{ name: "BNS-V2", type: "uint128" }],
} as const satisfies AbiContract;
