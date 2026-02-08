import { describe, expect, test } from "bun:test";
import { stackingDao } from "../index.ts";
import { STACKINGDAO_CONTRACTS, TRAIT_CONTRACTS } from "../constants.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import { mainnet, testnet } from "../../chains/index.ts";
import { http } from "../../transports/http.ts";

const DEPLOYER = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG";

describe("StackingDAO Extension", () => {
  describe("Constants", () => {
    test("core contract address", () => {
      expect(STACKINGDAO_CONTRACTS.core.address).toBe(DEPLOYER);
      expect(STACKINGDAO_CONTRACTS.core.name).toBe("stacking-dao-core-v6");
    });

    test("ststx token address", () => {
      expect(STACKINGDAO_CONTRACTS.ststxToken.address).toBe(DEPLOYER);
      expect(STACKINGDAO_CONTRACTS.ststxToken.name).toBe("ststx-token");
    });

    test("trait contracts are set", () => {
      expect(TRAIT_CONTRACTS.reserve).toBe(`${DEPLOYER}.reserve-v1`);
      expect(TRAIT_CONTRACTS.commission).toBe(`${DEPLOYER}.commission-v2`);
      expect(TRAIT_CONTRACTS.directHelpers).toBe(`${DEPLOYER}.direct-helpers-v4`);
      expect(TRAIT_CONTRACTS.staking).toBe(`${DEPLOYER}.staking-v0`);
    });
  });

  describe("Extension", () => {
    test("extends client with stackingDao methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(stackingDao());

      expect(extended.stackingDao).toBeDefined();
      expect(typeof extended.stackingDao.deposit).toBe("function");
      expect(typeof extended.stackingDao.initWithdraw).toBe("function");
      expect(typeof extended.stackingDao.withdraw).toBe("function");
      expect(typeof extended.stackingDao.withdrawIdle).toBe("function");
      expect(typeof extended.stackingDao.getStSTXBalance).toBe("function");
      expect(typeof extended.stackingDao.getExchangeRate).toBe("function");
      expect(typeof extended.stackingDao.getTotalSupply).toBe("function");
      expect(typeof extended.stackingDao.getWithdrawalInfo).toBe("function");
      expect(typeof extended.stackingDao.getFees).toBe("function");
      expect(typeof extended.stackingDao.getReserveBalance).toBe("function");
      expect(typeof extended.stackingDao.getShutdownDeposits).toBe("function");
    });

    test("preserves original client methods", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      const extended = client.extend(stackingDao());

      expect(extended.chain).toBeDefined();
      expect(extended.transport).toBeDefined();
      expect(typeof extended.request).toBe("function");
    });
  });

  describe("Mainnet only", () => {
    test("throws on testnet", () => {
      const client = createPublicClient({
        chain: testnet,
        transport: http(),
      });

      const extended = client.extend(stackingDao());

      expect(() => extended.stackingDao.getStSTXBalance("SP1234")).toThrow(
        "StackingDAO is only available on mainnet"
      );
    });
  });

  describe("Type Safety", () => {
    test("types compile correctly", () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      }).extend(stackingDao());

      const _deposit: (params: { amount: bigint }) => Promise<string> = client.stackingDao.deposit;
      const _getBalance: (address: string) => Promise<bigint> = client.stackingDao.getStSTXBalance;
      const _getFees: () => Promise<{ stackFee: bigint; unstackFee: bigint; withdrawIdleFee: bigint }> = client.stackingDao.getFees;

      expect(true).toBe(true);
    });
  });
});
