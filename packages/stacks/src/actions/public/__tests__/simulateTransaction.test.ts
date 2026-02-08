import { describe, it, expect } from "bun:test";
import { simulateTransaction } from "../simulateTransaction.ts";
import { PayloadType, AddressHashMode, AuthType, AnchorMode, PostConditionModeWire } from "../../../transactions/types.ts";
import { Cl } from "../../../clarity/values.ts";
import type { Client } from "../../../clients/types.ts";
import type { StacksTransaction, ContractCallPayload, TokenTransferPayload, SmartContractPayload } from "../../../transactions/types.ts";
import { mainnet } from "../../../chains/definitions.ts";

function createMockClient(
  requestHandler: (path: string, init?: any) => Promise<any>,
  chain = mainnet,
): Client {
  return {
    chain,
    transport: { request: async () => ({}) },
    request: requestHandler,
    extend: () => ({}) as any,
  };
}

// Mainnet singleSig version=22, signer hash160 for SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7
const TEST_SIGNER = "a46ff88886c2ef9762d970b4d2c63678835b93cc";

function makeTxBase(payload: any): StacksTransaction {
  return {
    version: 0x00,
    chainId: 0x00000001,
    auth: {
      authType: AuthType.Standard,
      spendingCondition: {
        hashMode: AddressHashMode.P2PKH,
        signer: TEST_SIGNER,
        nonce: 0n,
        fee: 0n,
        keyEncoding: 0x00,
        signature: "00".repeat(65),
      },
    },
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionModeWire.Deny,
    postConditions: [],
    payload,
  };
}

function makeContractCallTx(): StacksTransaction {
  const payload: ContractCallPayload = {
    payloadType: PayloadType.ContractCall,
    contractAddress: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
    contractName: "arkadiko-token",
    functionName: "transfer",
    functionArgs: [Cl.uint(100)],
  };
  return makeTxBase(payload);
}

function makeTokenTransferTx(): StacksTransaction {
  const payload: TokenTransferPayload = {
    payloadType: PayloadType.TokenTransfer,
    recipient: Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"),
    amount: 1000000n,
    memo: "",
  };
  return makeTxBase(payload);
}

function makeDeployTx(): StacksTransaction {
  const payload: SmartContractPayload = {
    payloadType: PayloadType.SmartContract,
    contractName: "my-contract",
    codeBody: "(define-public (hello) (ok true))",
  };
  return makeTxBase(payload);
}

describe("simulateTransaction", () => {
  it("contract call success → returns execution + fees", async () => {
    const client = createMockClient(async (path) => {
      if (path.includes("/v2/contracts/call-read/")) {
        return { okay: true, result: Cl.serialize(Cl.ok(Cl.bool(true))) };
      }
      if (path.includes("/v2/fees/transaction")) {
        return { estimations: [{ feeRate: 1, fee: 200 }] };
      }
    });

    const result = await simulateTransaction(client, {
      transaction: makeContractCallTx(),
    });

    expect(result.type).toBe("contract-call");
    if (result.type === "contract-call") {
      expect(result.execution.success).toBe(true);
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0].fee).toBe(200);
    }
  });

  it("contract call failure → returns execution error + fees", async () => {
    const client = createMockClient(async (path) => {
      if (path.includes("/v2/contracts/call-read/")) {
        return { okay: false, cause: "Unchecked(NoSuchContract)" };
      }
      if (path.includes("/v2/fees/transaction")) {
        return { estimations: [{ feeRate: 1, fee: 100 }] };
      }
    });

    const result = await simulateTransaction(client, {
      transaction: makeContractCallTx(),
    });

    expect(result.type).toBe("contract-call");
    if (result.type === "contract-call") {
      expect(result.execution.success).toBe(false);
      expect(result.fees).toHaveLength(1);
    }
  });

  it("token transfer → returns fees only", async () => {
    const client = createMockClient(async () => ({
      estimations: [{ feeRate: 1, fee: 180 }],
    }));

    const result = await simulateTransaction(client, {
      transaction: makeTokenTransferTx(),
    });

    expect(result.type).toBe("token-transfer");
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].fee).toBe(180);
    expect((result as any).execution).toBeUndefined();
  });

  it("contract deploy → returns fees only", async () => {
    const client = createMockClient(async () => ({
      estimations: [{ feeRate: 2, fee: 5000 }],
    }));

    const result = await simulateTransaction(client, {
      transaction: makeDeployTx(),
    });

    expect(result.type).toBe("contract-deploy");
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].fee).toBe(5000);
    expect((result as any).execution).toBeUndefined();
  });

  it("sender override works for contract call", async () => {
    let capturedBody: any;
    const client = createMockClient(async (path, init) => {
      if (path.includes("/v2/contracts/call-read/")) {
        capturedBody = init?.body;
        return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
      }
      return { estimations: [] };
    });

    await simulateTransaction(client, {
      transaction: makeContractCallTx(),
      sender: "SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159",
    });

    expect(capturedBody.sender).toBe("SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159");
  });

  it("default sender extracted from tx auth", async () => {
    let capturedBody: any;
    const client = createMockClient(async (path, init) => {
      if (path.includes("/v2/contracts/call-read/")) {
        capturedBody = init?.body;
        return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
      }
      return { estimations: [] };
    });

    await simulateTransaction(client, {
      transaction: makeContractCallTx(),
    });

    // Sender should be derived from signer hash + mainnet singleSig version (22)
    expect(capturedBody.sender).toBeDefined();
    expect(capturedBody.sender).toMatch(/^SP/);
  });

  it("passes tip to simulateCall", async () => {
    let capturedPath = "";
    const client = createMockClient(async (path) => {
      if (path.includes("/v2/contracts/call-read/")) {
        capturedPath = path;
        return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
      }
      return { estimations: [] };
    });

    await simulateTransaction(client, {
      transaction: makeContractCallTx(),
      tip: "latest",
    });

    expect(capturedPath).toContain("?tip=latest");
  });
});
