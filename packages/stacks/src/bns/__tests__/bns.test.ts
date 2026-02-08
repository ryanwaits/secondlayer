import { describe, expect, test, mock } from "bun:test";
import { bns } from "../index.ts";
import {
  parseFQN,
  validateFQN,
  formatFQN,
  generateSalt,
  hashPreorder,
} from "../utils.ts";
import { BNS_CONTRACTS, ZONEFILE_RESOLVER_CONTRACTS } from "../constants.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import { mainnet } from "../../chains/index.ts";
import { http } from "../../transports/http.ts";

describe("BNS Extension", () => {
  describe("Utils", () => {
    test("parseFQN with namespace", () => {
      const result = parseFQN("alice.btc");
      expect(result).toEqual({ name: "alice", namespace: "btc" });
    });

    test("parseFQN without namespace defaults to btc", () => {
      const result = parseFQN("alice");
      expect(result).toEqual({ name: "alice", namespace: "btc" });
    });

    test("parseFQN throws on invalid format", () => {
      expect(() => parseFQN("alice.bob.btc")).toThrow("Invalid fully qualified name");
    });

    test("formatFQN combines name and namespace", () => {
      expect(formatFQN("alice", "btc")).toBe("alice.btc");
    });

    test("validateFQN accepts valid names", () => {
      expect(validateFQN("alice.btc")).toBe(true);
      expect(validateFQN("alice")).toBe(true);
      expect(validateFQN("alice-bob.btc")).toBe(true);
      expect(validateFQN("alice_bob.btc")).toBe(true);
    });

    test("validateFQN rejects invalid names", () => {
      expect(validateFQN("")).toBe(false);
      expect(validateFQN("-alice.btc")).toBe(false); // starts with hyphen
      expect(validateFQN("alice-.btc")).toBe(false); // ends with hyphen
      expect(validateFQN("Alice.btc")).toBe(false); // uppercase
      expect(validateFQN("alice.btc.xyz")).toBe(false); // too many parts
    });

    test("generateSalt creates 20-byte random values", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      expect(salt1).toBeInstanceOf(Uint8Array);
      expect(salt1.length).toBe(20);
      expect(salt2.length).toBe(20);

      // Should be different (extremely unlikely to be the same)
      expect(salt1).not.toEqual(salt2);
    });

    test("hashPreorder produces 20-byte hash160", () => {
      const salt = generateSalt();
      const hash = hashPreorder("alice", "btc", salt);

      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(20);
    });

    test("hashPreorder is deterministic", () => {
      const salt = new Uint8Array(20).fill(1); // Fixed salt
      const hash1 = hashPreorder("alice", "btc", salt);
      const hash2 = hashPreorder("alice", "btc", salt);

      expect(hash1).toEqual(hash2);
    });

    test("hashPreorder differs with different inputs", () => {
      const salt = new Uint8Array(20).fill(1);
      const hash1 = hashPreorder("alice", "btc", salt);
      const hash2 = hashPreorder("bob", "btc", salt);
      const hash3 = hashPreorder("alice", "stx", salt);

      expect(hash1).not.toEqual(hash2);
      expect(hash1).not.toEqual(hash3);
    });
  });

  describe("Constants", () => {
    test("mainnet contract address is correct", () => {
      expect(BNS_CONTRACTS.mainnet.address).toBe("SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF");
      expect(BNS_CONTRACTS.mainnet.name).toBe("BNS-V2");
    });

    test("testnet contract address is correct", () => {
      expect(BNS_CONTRACTS.testnet.address).toBe("ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D9SZJQ0M");
      expect(BNS_CONTRACTS.testnet.name).toBe("BNS-V2");
    });

    test("zonefile resolver mainnet address is correct", () => {
      expect(ZONEFILE_RESOLVER_CONTRACTS.mainnet.address).toBe(
        "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF"
      );
      expect(ZONEFILE_RESOLVER_CONTRACTS.mainnet.name).toBe("zonefile-resolver");
    });

    test("zonefile resolver testnet address is correct", () => {
      expect(ZONEFILE_RESOLVER_CONTRACTS.testnet.address).toBe(
        "ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D9SZJQ0M"
      );
      expect(ZONEFILE_RESOLVER_CONTRACTS.testnet.name).toBe("zonefile-resolver");
    });
  });

  describe("Extension", () => {
    test("extends client with bns methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(bns());

      expect(extended.bns).toBeDefined();
      expect(typeof extended.bns.resolveName).toBe("function");
      expect(typeof extended.bns.getPrimaryName).toBe("function");
      expect(typeof extended.bns.canRegister).toBe("function");
      expect(typeof extended.bns.getNamePrice).toBe("function");
      expect(typeof extended.bns.getNameId).toBe("function");
      expect(typeof extended.bns.preorder).toBe("function");
      expect(typeof extended.bns.register).toBe("function");
      expect(typeof extended.bns.claimFast).toBe("function");
      expect(typeof extended.bns.transfer).toBe("function");
      expect(typeof extended.bns.setPrimary).toBe("function");
      expect(typeof extended.bns.getZonefile).toBe("function");
      expect(typeof extended.bns.updateZonefile).toBe("function");
      expect(typeof extended.bns.revokeZonefile).toBe("function");
    });

    test("preserves original client methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(bns());

      // Original methods should still exist
      expect(extended.chain).toBeDefined();
      expect(extended.transport).toBeDefined();
      expect(typeof extended.request).toBe("function");
    });
  });

  describe("Type Safety", () => {
    test("TypeScript types are exported", () => {
      // This is a type-level test - if it compiles, types are correct
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      }).extend(bns());

      // These should all be typed correctly
      const _resolveName: (name: string) => Promise<string | null> = client.bns.resolveName;
      const _getPrimaryName: (address: string) => Promise<string | null> = client.bns.getPrimaryName;
      const _canRegister: (name: string) => Promise<boolean> = client.bns.canRegister;
      const _getNamePrice: (name: string) => Promise<bigint> = client.bns.getNamePrice;
      const _getNameId: (name: string) => Promise<bigint | null> = client.bns.getNameId;

      expect(true).toBe(true); // Type check passes
    });
  });
});
