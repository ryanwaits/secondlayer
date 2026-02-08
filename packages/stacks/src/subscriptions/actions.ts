import type { Client } from "../clients/types.ts";
import type { WebSocketTransport } from "../transports/webSocket.ts";
import type {
  Subscription,
  BlockNotification,
  MempoolNotification,
  TxUpdateNotification,
  AddressTxNotification,
  AddressBalanceNotification,
  NftEventNotification,
} from "./types.ts";
import { WebSocketError } from "../errors/websocket.ts";

function getWsTransport(client: Client): WebSocketTransport {
  if (client.transport.type !== "webSocket") {
    throw new WebSocketError(
      "Watch actions require a webSocket transport. Use `webSocket()` when creating your client."
    );
  }
  return client.transport as WebSocketTransport;
}

export type WatchBlocksParams = {
  onBlock: (block: BlockNotification) => void;
};

export async function watchBlocks(
  client: Client,
  params: WatchBlocksParams
): Promise<Subscription> {
  const transport = getWsTransport(client);
  return transport.subscribe({ event: "block" }, params.onBlock);
}

export type WatchMempoolParams = {
  onTransaction: (tx: MempoolNotification) => void;
};

export async function watchMempool(
  client: Client,
  params: WatchMempoolParams
): Promise<Subscription> {
  const transport = getWsTransport(client);
  return transport.subscribe({ event: "mempool" }, params.onTransaction);
}

export type WatchTransactionParams = {
  txId: string;
  onUpdate: (update: TxUpdateNotification) => void;
};

export async function watchTransaction(
  client: Client,
  params: WatchTransactionParams
): Promise<Subscription> {
  const transport = getWsTransport(client);
  return transport.subscribe(
    { event: "tx_update", tx_id: params.txId },
    params.onUpdate
  );
}

export type WatchAddressParams = {
  address: string;
  onTransaction: (tx: AddressTxNotification) => void;
};

export async function watchAddress(
  client: Client,
  params: WatchAddressParams
): Promise<Subscription> {
  const transport = getWsTransport(client);
  return transport.subscribe(
    { event: "address_tx_update", address: params.address },
    params.onTransaction
  );
}

export type WatchAddressBalanceParams = {
  address: string;
  onBalance: (balance: AddressBalanceNotification) => void;
};

export async function watchAddressBalance(
  client: Client,
  params: WatchAddressBalanceParams
): Promise<Subscription> {
  const transport = getWsTransport(client);
  return transport.subscribe(
    { event: "address_balance_update", address: params.address },
    params.onBalance
  );
}

export type WatchNftEventParams = {
  onEvent: (event: NftEventNotification) => void;
  assetIdentifier?: string;
  value?: string;
};

export async function watchNftEvent(
  client: Client,
  params: WatchNftEventParams
): Promise<Subscription> {
  const transport = getWsTransport(client);

  let event: "nft_event" | "nft_asset_event" | "nft_collection_event";
  if (params.assetIdentifier && params.value) {
    event = "nft_event";
  } else if (params.assetIdentifier) {
    event = "nft_collection_event";
  } else {
    event = "nft_event";
  }

  return transport.subscribe(
    {
      event,
      asset_identifier: params.assetIdentifier,
      value: params.value,
    },
    params.onEvent
  );
}
