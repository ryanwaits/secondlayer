import { test, expect, describe, mock } from "bun:test";
import {
  watchBlocks,
  watchMempool,
  watchTransaction,
  watchAddress,
  watchAddressBalance,
  watchNftEvent,
} from "../actions.ts";
import type { Client } from "../../clients/types.ts";
import type { WebSocketTransport } from "../../transports/webSocket.ts";
import type { Subscription, WsSubscribeParams } from "../types.ts";

function mockWsClient(): Client & { subscribeCalls: Array<{ params: WsSubscribeParams; callback: Function }> } {
  const subscribeCalls: Array<{ params: WsSubscribeParams; callback: Function }> = [];

  const transport: WebSocketTransport = {
    type: "webSocket",
    request: mock(() => Promise.resolve({})),
    config: {},
    subscribe: mock((params: WsSubscribeParams, callback: (data: any) => void): Promise<Subscription> => {
      subscribeCalls.push({ params, callback });
      return Promise.resolve({ unsubscribe: () => {} });
    }),
    destroy: mock(() => {}),
  };

  return {
    transport,
    request: transport.request,
    extend: () => ({}) as any,
    subscribeCalls,
  };
}

function mockHttpClient(): Client {
  return {
    transport: { type: "http", request: mock(() => Promise.resolve({})), config: {} },
    request: mock(() => Promise.resolve({})),
    extend: () => ({}) as any,
  };
}

describe("watch actions", () => {
  test("watchBlocks subscribes to block event", async () => {
    const client = mockWsClient();
    const onBlock = mock(() => {});

    await watchBlocks(client, { onBlock });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params).toEqual({ event: "block" });
  });

  test("watchMempool subscribes to mempool event", async () => {
    const client = mockWsClient();
    const onTransaction = mock(() => {});

    await watchMempool(client, { onTransaction });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params).toEqual({ event: "mempool" });
  });

  test("watchTransaction subscribes with tx_id", async () => {
    const client = mockWsClient();
    const onUpdate = mock(() => {});

    await watchTransaction(client, {
      txId: "0xabc123",
      onUpdate,
    });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params).toEqual({
      event: "tx_update",
      tx_id: "0xabc123",
    });
  });

  test("watchAddress subscribes with address", async () => {
    const client = mockWsClient();
    const onTransaction = mock(() => {});

    await watchAddress(client, {
      address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      onTransaction,
    });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params).toEqual({
      event: "address_tx_update",
      address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    });
  });

  test("watchAddressBalance subscribes with address", async () => {
    const client = mockWsClient();
    const onBalance = mock(() => {});

    await watchAddressBalance(client, {
      address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      onBalance,
    });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params).toEqual({
      event: "address_balance_update",
      address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    });
  });

  test("watchNftEvent subscribes with asset identifier", async () => {
    const client = mockWsClient();
    const onEvent = mock(() => {});

    await watchNftEvent(client, {
      assetIdentifier: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.nft::token",
      onEvent,
    });

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].params.event).toBe("nft_collection_event");
    expect(client.subscribeCalls[0].params.asset_identifier).toBe(
      "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.nft::token"
    );
  });

  test("watchNftEvent with asset + value subscribes to nft_event", async () => {
    const client = mockWsClient();
    const onEvent = mock(() => {});

    await watchNftEvent(client, {
      assetIdentifier: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.nft::token",
      value: "0x0100000000000000000000000000000001",
      onEvent,
    });

    expect(client.subscribeCalls[0].params.event).toBe("nft_event");
  });

  test("throws WebSocketError when transport is not webSocket", async () => {
    const client = mockHttpClient();

    expect(
      watchBlocks(client, { onBlock: () => {} })
    ).rejects.toThrow("Watch actions require a webSocket transport");
  });
});
