import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { StacksNodeClient } from "../src/node/client.ts";

// Mock server for testing
let mockServer: ReturnType<typeof Bun.serve>;
const MOCK_PORT = 19443;

beforeAll(() => {
  mockServer = Bun.serve({
    port: MOCK_PORT,
    routes: {
      "/v2/info": () =>
        Response.json({
          peer_version: 1,
          pox_consensus: "abc",
          burn_block_height: 100,
          stable_pox_consensus: "abc",
          stable_burn_block_height: 99,
          server_version: "test",
          network_id: 1,
          parent_network_id: 1,
          stacks_tip_height: 500,
          stacks_tip: "0xabc",
          stacks_tip_consensus_hash: "abc",
          genesis_chainstate_hash: "abc",
        }),
      "/v2/blocks/1": () =>
        Response.json({
          hash: "0xblock1",
          height: 1,
          parent_block_hash: "0xgenesis",
          burn_block_height: 1,
          burn_block_hash: "0xburn1",
          burn_block_time: 1000,
          index_block_hash: "0xidx1",
          parent_index_block_hash: "0xidx0",
          miner_txid: "0x0",
          txs: [],
        }),
      "/v2/blocks/999999": () => new Response("Not Found", { status: 404 }),
    },
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer.stop();
});

describe("StacksNodeClient", () => {
  const client = new StacksNodeClient(`http://localhost:${MOCK_PORT}`);

  test("getInfo returns node info", async () => {
    const info = await client.getInfo();
    expect(info.stacks_tip_height).toBe(500);
  });

  test("isHealthy returns true for healthy node", async () => {
    expect(await client.isHealthy()).toBe(true);
  });

  test("isHealthy returns false for unreachable node", async () => {
    const bad = new StacksNodeClient("http://localhost:1");
    expect(await bad.isHealthy()).toBe(false);
  });

  test("getBlock returns block data", async () => {
    const block = await client.getBlock(1);
    expect(block).not.toBeNull();
    expect(block!.height).toBe(1);
    expect(block!.hash).toBe("0xblock1");
  });

  test("getBlock returns null for missing block", async () => {
    const block = await client.getBlock(999999);
    expect(block).toBeNull();
  });

  test("getRpcUrl returns configured URL", () => {
    expect(client.getRpcUrl()).toBe(`http://localhost:${MOCK_PORT}`);
  });
});
