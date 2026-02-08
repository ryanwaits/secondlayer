import { describe, it, expect } from "bun:test";
import { simulateCall } from "../simulateCall.ts";
import { Cl } from "../../../clarity/values.ts";
import { SimulationError } from "../../../errors/simulation.ts";
import type { Client } from "../../../clients/types.ts";

function createMockClient(
  requestHandler: (path: string, init?: any) => Promise<any>,
): Client {
  return {
    transport: { request: async () => ({}) },
    request: requestHandler,
    extend: () => ({}) as any,
  };
}

describe("simulateCall", () => {
  const contract = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token";

  it("returns success with deserialized ClarityValue on okay:true", async () => {
    const client = createMockClient(async () => ({
      okay: true,
      result: Cl.serialize(Cl.ok(Cl.bool(true))),
    }));

    const result = await simulateCall(client, {
      contract,
      functionName: "transfer",
      args: [Cl.uint(100)],
      sender: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBeDefined();
    }
  });

  it("returns failure with SimulationError on okay:false", async () => {
    const client = createMockClient(async () => ({
      okay: false,
      cause: "Unchecked(NoSuchContract)",
    }));

    const result = await simulateCall(client, {
      contract,
      functionName: "bad-fn",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SimulationError);
      expect(result.error.writesDetected).toBe(false);
      expect(result.error.details).toContain("NoSuchContract");
    }
  });

  it("detects NotReadOnly as writesDetected", async () => {
    const client = createMockClient(async () => ({
      okay: false,
      cause: "NotReadOnly",
    }));

    const result = await simulateCall(client, {
      contract,
      functionName: "mint",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.writesDetected).toBe(true);
      expect(result.error.shortMessage).toBe(
        "Function mutates state and cannot be simulated",
      );
    }
  });

  it("detects CostBalanceExceeded as writesDetected", async () => {
    const client = createMockClient(async () => ({
      okay: false,
      cause: "CostBalanceExceeded",
    }));

    const result = await simulateCall(client, {
      contract,
      functionName: "expensive-fn",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.writesDetected).toBe(true);
    }
  });

  it("defaults sender to contract deployer", async () => {
    let capturedBody: any;
    const client = createMockClient(async (_path, init) => {
      capturedBody = init?.body;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, { contract, functionName: "get-balance" });

    expect(capturedBody.sender).toBe(
      "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
    );
  });

  it("uses explicit sender when provided", async () => {
    let capturedBody: any;
    const client = createMockClient(async (_path, init) => {
      capturedBody = init?.body;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, {
      contract,
      functionName: "get-balance",
      sender: "SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159",
    });

    expect(capturedBody.sender).toBe(
      "SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159",
    );
  });

  it("appends tip query param when provided", async () => {
    let capturedPath = "";
    const client = createMockClient(async (path) => {
      capturedPath = path;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, {
      contract,
      functionName: "get-balance",
      tip: "latest",
    });

    expect(capturedPath).toContain("?tip=latest");
  });

  it("omits tip param when not provided", async () => {
    let capturedPath = "";
    const client = createMockClient(async (path) => {
      capturedPath = path;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, { contract, functionName: "get-balance" });

    expect(capturedPath).not.toContain("?tip=");
  });

  it("serializes args correctly", async () => {
    let capturedBody: any;
    const client = createMockClient(async (_path, init) => {
      capturedBody = init?.body;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, {
      contract,
      functionName: "transfer",
      args: [Cl.uint(100), Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")],
    });

    expect(capturedBody.arguments).toHaveLength(2);
    capturedBody.arguments.forEach((arg: string) => {
      expect(arg.startsWith("0x")).toBe(true);
    });
  });

  it("builds correct request path", async () => {
    let capturedPath = "";
    const client = createMockClient(async (path) => {
      capturedPath = path;
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    await simulateCall(client, { contract, functionName: "transfer" });

    expect(capturedPath).toBe(
      "/v2/contracts/call-read/SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR/arkadiko-token/transfer",
    );
  });

  it("handles missing cause in failure response", async () => {
    const client = createMockClient(async () => ({
      okay: false,
    }));

    const result = await simulateCall(client, {
      contract,
      functionName: "broken",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.writesDetected).toBe(false);
      expect(result.error.shortMessage).toBe("Simulation failed");
    }
  });
});
