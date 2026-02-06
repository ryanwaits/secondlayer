import type { Client } from "../../clients/types.ts";

export type GetBalanceParams = {
  address: string;
};

export async function getBalance(
  client: Client,
  params: GetBalanceParams
): Promise<bigint> {
  const data = await client.request(`/v2/accounts/${params.address}`, {
    method: "GET",
  });
  return BigInt(data.balance);
}
