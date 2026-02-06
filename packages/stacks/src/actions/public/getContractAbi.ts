import type { Client } from "../../clients/types.ts";
import { parseContractId } from "../../utils/address.ts";

export type GetContractAbiParams = {
  contract: string; // "address.name"
};

export async function getContractAbi(
  client: Client,
  params: GetContractAbiParams
): Promise<any> {
  const [address, name] = parseContractId(params.contract);
  return client.request(`/v2/contracts/interface/${address}/${name}`, {
    method: "GET",
  });
}
