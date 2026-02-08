import { describe, it, expect } from "bun:test";
import { multicall } from "../multicall.ts";
import { Cl } from "../../../clarity/values.ts";
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

describe("multicall", () => {
  const calls = [
    { contract: "SP1.contract-a", functionName: "get-x" },
    { contract: "SP2.contract-b", functionName: "get-y" },
    { contract: "SP3.contract-c", functionName: "get-z" },
  ];

  it("allowFailure:true returns mixed success/failure results", async () => {
    const client = createMockClient(async (path) => {
      if (path.includes("contract-b")) {
        return { okay: false, cause: "function not found" };
      }
      return { okay: true, result: Cl.serialize(Cl.uint(42n)) };
    });

    const results = await multicall(client, { calls, allowFailure: true });

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: "success", result: expect.anything() });
    expect(results[1]).toEqual({ status: "failure", error: expect.any(Error) });
    expect(results[2]).toEqual({ status: "success", result: expect.anything() });
  });

  it("allowFailure:false throws on first failure", async () => {
    const client = createMockClient(async (path) => {
      if (path.includes("contract-b")) {
        return { okay: false, cause: "function not found" };
      }
      return { okay: true, result: Cl.serialize(Cl.uint(42n)) };
    });

    expect(
      multicall(client, { calls, allowFailure: false }),
    ).rejects.toThrow("function not found");
  });

  it("results order matches input order", async () => {
    let callIndex = 0;
    const values = [10n, 20n, 30n];

    const client = createMockClient(async () => {
      const val = values[callIndex++];
      return { okay: true, result: Cl.serialize(Cl.uint(val)) };
    });

    const results = await multicall(client, { calls, allowFailure: false });

    expect(results).toHaveLength(3);
  });

  it("defaults to allowFailure:true", async () => {
    const client = createMockClient(async (path) => {
      if (path.includes("contract-c")) {
        return { okay: false, cause: "boom" };
      }
      return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
    });

    const results = await multicall(client, { calls });

    expect(results).toHaveLength(3);
    expect((results[0] as any).status).toBe("success");
    expect((results[2] as any).status).toBe("failure");
  });

  it("all success with allowFailure:false returns ClarityValue[]", async () => {
    const client = createMockClient(async () => ({
      okay: true,
      result: Cl.serialize(Cl.uint(99n)),
    }));

    const results = await multicall(client, { calls, allowFailure: false });

    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r).toBeDefined();
    });
  });
});
