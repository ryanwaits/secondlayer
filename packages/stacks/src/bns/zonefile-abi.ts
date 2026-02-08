import type { AbiContract } from "../clarity/abi/contract.ts";

/**
 * BNS v2 Zonefile Resolver ABI
 * Manages DNS-like records for BNS names (up to 8192 bytes).
 * Separate contract from BNS-V2 for decoupled zonefile management.
 */
export const ZONEFILE_RESOLVER_ABI = {
  functions: [
    {
      name: "resolve-name",
      access: "read-only",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
      ],
      outputs: {
        response: {
          ok: { optional: { buff: { length: 8192 } } },
          error: "uint128",
        },
      },
    },
    {
      name: "update-zonefile",
      access: "public",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
        { name: "new-zonefile", type: { optional: { buff: { length: 8192 } } } },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
    {
      name: "revoke-name",
      access: "public",
      args: [
        { name: "name", type: { buff: { length: 48 } } },
        { name: "namespace", type: { buff: { length: 20 } } },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
  ],
} as const satisfies AbiContract;
