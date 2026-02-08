import type { Client } from "../../clients/types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";
import { parseContractId } from "../../utils/address.ts";
import { SimulationError } from "../../errors/simulation.ts";

export type SimulateCallParams = {
  contract: string;
  functionName: string;
  args?: ClarityValue[];
  sender?: string;
  tip?: string;
};

export type SimulateCallSuccess = { success: true; result: ClarityValue };
export type SimulateCallFailure = { success: false; error: SimulationError };
export type SimulateCallResult = SimulateCallSuccess | SimulateCallFailure;

export async function simulateCall(
  client: Client,
  params: SimulateCallParams
): Promise<SimulateCallResult> {
  const [address, name] = parseContractId(params.contract);
  const sender = params.sender ?? address;

  const serializedArgs = (params.args ?? []).map((arg) =>
    with0x(bytesToHex(serializeCVBytes(arg)))
  );

  let path = `/v2/contracts/call-read/${address}/${name}/${params.functionName}`;
  if (params.tip) {
    path += `?tip=${params.tip}`;
  }

  const data = await client.request(path, {
    method: "POST",
    body: {
      sender,
      arguments: serializedArgs,
    },
  });

  if (data.okay) {
    return { success: true, result: deserializeCVBytes(data.result) };
  }

  const cause: string = data.cause ?? "Simulation failed";
  const writesDetected =
    cause.includes("NotReadOnly") || cause.includes("CostBalanceExceeded");

  return {
    success: false,
    error: new SimulationError(
      writesDetected
        ? "Function mutates state and cannot be simulated"
        : "Simulation failed",
      { writesDetected, details: cause }
    ),
  };
}
