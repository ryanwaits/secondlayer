import { describe, expect, test } from "bun:test";
import { pox } from "../index.ts";
import {
  parseBtcAddress,
  validateLockPeriod,
  burnHeightToRewardCycle,
  rewardCycleToBurnHeight,
} from "../utils.ts";
import { POX_CONTRACTS, POX_ADDRESS_VERSION } from "../constants.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import { mainnet } from "../../chains/index.ts";
import { http } from "../../transports/http.ts";

describe("PoX Extension", () => {
  describe("Utils", () => {
    describe("parseBtcAddress", () => {
      test("P2PKH mainnet (starts with 1)", () => {
        const addr = parseBtcAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2pkh);
        expect(addr.hashbytes.length).toBe(32);
        // First 20 bytes should be non-zero hash
        expect(addr.hashbytes.slice(0, 20).some((b) => b !== 0)).toBe(true);
        // Last 12 bytes should be zero padding
        expect(addr.hashbytes.slice(20).every((b) => b === 0)).toBe(true);
      });

      test("P2SH mainnet (starts with 3)", () => {
        const addr = parseBtcAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2sh);
        expect(addr.hashbytes.length).toBe(32);
      });

      test("P2WPKH (bc1q, 20-byte program)", () => {
        const addr = parseBtcAddress(
          "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        );
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2wpkh);
        expect(addr.hashbytes.length).toBe(32);
        // First 20 bytes are the witness program
        expect(addr.hashbytes.slice(0, 20).some((b) => b !== 0)).toBe(true);
        expect(addr.hashbytes.slice(20).every((b) => b === 0)).toBe(true);
      });

      test("P2WSH (bc1q, 32-byte program)", () => {
        // Valid P2WSH: bc1q + 32-byte witness program (bech32)
        const addr = parseBtcAddress(
          "bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej"
        );
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2wsh);
        expect(addr.hashbytes.length).toBe(32);
      });

      test("P2TR (bc1p, taproot)", () => {
        // Valid P2TR: bc1p + 32-byte witness program (bech32m)
        const addr = parseBtcAddress(
          "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"
        );
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2tr);
        expect(addr.hashbytes.length).toBe(32);
      });

      test("testnet P2WPKH (tb1q)", () => {
        const addr = parseBtcAddress(
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
        );
        expect(addr.version[0]).toBe(POX_ADDRESS_VERSION.p2wpkh);
      });

      test("throws on invalid address", () => {
        expect(() => parseBtcAddress("invalid")).toThrow();
        expect(() => parseBtcAddress("")).toThrow();
      });
    });

    describe("validateLockPeriod", () => {
      test("accepts 1-12", () => {
        for (let i = 1; i <= 12; i++) {
          expect(validateLockPeriod(i)).toBe(true);
        }
      });

      test("rejects 0", () => {
        expect(validateLockPeriod(0)).toBe(false);
      });

      test("rejects 13+", () => {
        expect(validateLockPeriod(13)).toBe(false);
        expect(validateLockPeriod(100)).toBe(false);
      });

      test("rejects non-integers", () => {
        expect(validateLockPeriod(1.5)).toBe(false);
      });
    });

    describe("cycle calculations", () => {
      const firstHeight = 666050n;
      const cycleLength = 2100n;

      test("burnHeightToRewardCycle", () => {
        expect(
          burnHeightToRewardCycle(666050n, firstHeight, cycleLength)
        ).toBe(0n);
        expect(
          burnHeightToRewardCycle(668150n, firstHeight, cycleLength)
        ).toBe(1n);
        expect(
          burnHeightToRewardCycle(670250n, firstHeight, cycleLength)
        ).toBe(2n);
      });

      test("rewardCycleToBurnHeight", () => {
        expect(rewardCycleToBurnHeight(0n, firstHeight, cycleLength)).toBe(
          666050n
        );
        expect(rewardCycleToBurnHeight(1n, firstHeight, cycleLength)).toBe(
          668150n
        );
        expect(rewardCycleToBurnHeight(10n, firstHeight, cycleLength)).toBe(
          687050n
        );
      });
    });
  });

  describe("Constants", () => {
    test("mainnet contract address", () => {
      expect(POX_CONTRACTS.mainnet.address).toBe(
        "SP000000000000000000002Q6VF78"
      );
      expect(POX_CONTRACTS.mainnet.name).toBe("pox-4");
    });

    test("testnet contract address", () => {
      expect(POX_CONTRACTS.testnet.address).toBe(
        "ST000000000000000000002AMW42H"
      );
      expect(POX_CONTRACTS.testnet.name).toBe("pox-4");
    });
  });

  describe("Extension", () => {
    test("extends client with pox methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(pox());

      expect(extended.pox).toBeDefined();
      expect(typeof extended.pox.getPoxInfo).toBe("function");
      expect(typeof extended.pox.getStackerInfo).toBe("function");
      expect(typeof extended.pox.getDelegationInfo).toBe("function");
      expect(typeof extended.pox.canStack).toBe("function");
      expect(typeof extended.pox.stackStx).toBe("function");
      expect(typeof extended.pox.delegateStx).toBe("function");
      expect(typeof extended.pox.revokeDelegateStx).toBe("function");
      expect(typeof extended.pox.stackExtend).toBe("function");
      expect(typeof extended.pox.stackIncrease).toBe("function");
    });

    test("preserves original client methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(pox());

      expect(extended.chain).toBeDefined();
      expect(extended.transport).toBeDefined();
      expect(typeof extended.request).toBe("function");
    });
  });
});
