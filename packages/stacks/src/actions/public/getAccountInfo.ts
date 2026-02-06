import type { Client } from "../../clients/types.ts";

export type GetAccountInfoParams = {
  address: string;
};

export type AccountInfo = {
  balance: bigint;
  nonce: bigint;
  balanceProof: string;
  nonceProof: string;
};

export async function getAccountInfo(
  client: Client,
  params: GetAccountInfoParams
): Promise<AccountInfo> {
  const data = await client.request(
    `/v2/accounts/${params.address}?proof=1`,
    { method: "GET" }
  );
  return {
    balance: BigInt(data.balance),
    nonce: BigInt(data.nonce),
    balanceProof: data.balance_proof ?? "",
    nonceProof: data.nonce_proof ?? "",
  };
}
