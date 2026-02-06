import type { Client } from "../../clients/types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";
import { parseContractId } from "../../utils/address.ts";

export type ReadContractParams = {
  contract: string; // "address.name"
  functionName: string;
  args?: ClarityValue[];
  sender?: string;
};

export async function readContract<T extends ClarityValue = ClarityValue>(
  client: Client,
  params: ReadContractParams
): Promise<T> {
  const [address, name] = parseContractId(params.contract);
  const sender = params.sender ?? address;

  const serializedArgs = (params.args ?? []).map((arg) =>
    with0x(bytesToHex(serializeCVBytes(arg)))
  );

  const data = await client.request(
    `/v2/contracts/call-read/${address}/${name}/${params.functionName}`,
    {
      method: "POST",
      body: {
        sender,
        arguments: serializedArgs,
      },
    }
  );

  if (data.okay) {
    return deserializeCVBytes<T>(data.result);
  }
  throw new Error(data.cause ?? "Read-only call failed");
}
