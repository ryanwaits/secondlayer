import type { Client } from "../../clients/types.ts";

export type GetBlockParams = {
  height?: number;
  hash?: string;
};

export async function getBlock(client: Client, params?: GetBlockParams): Promise<any> {
  if (params?.hash) {
    return client.request(`/extended/v2/blocks/${params.hash}`, { method: "GET" });
  }
  if (params?.height !== undefined) {
    return client.request(`/extended/v2/blocks/${params.height}`, { method: "GET" });
  }
  // Latest block
  return client.request("/extended/v2/blocks?limit=1", { method: "GET" });
}
