import type { Client } from "../../clients/types.ts";

export async function getBlockHeight(client: Client): Promise<number> {
  const data = await client.request("/v2/info", { method: "GET" });
  return data.stacks_tip_height;
}
