import type { Client } from "../../clients/types.ts";

export type GetNonceParams = {
  address: string;
};

export type GetNonceResult = {
  nonce: bigint;
  possibleNextNonce: bigint;
};

export async function getNonce(
  client: Client,
  params: GetNonceParams
): Promise<bigint> {
  const data = await client.request(`/v2/accounts/${params.address}`, {
    method: "GET",
  });
  return BigInt(data.nonce);
}
