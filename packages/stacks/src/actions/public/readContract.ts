import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import {
	MalformedResponseError,
	ReadContractError,
} from "../../errors/response.ts";
import { parseContractId } from "../../utils/address.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";

export type ReadContractParams = {
	contract: string; // "address.name"
	functionName: string;
	args?: ClarityValue[];
	sender?: string;
	/**
	 * Nakamoto StacksBlockId to evaluate against. Without it the node answers
	 * at its own moving tip, which makes a read non-deterministic — the same
	 * reindex of the same block can return a different value.
	 */
	tip?: string;
};

export async function readContract<T extends ClarityValue = ClarityValue>(
	client: Client,
	params: ReadContractParams,
): Promise<T> {
	const [address, name] = parseContractId(params.contract);
	const sender = params.sender ?? address;

	const serializedArgs = (params.args ?? []).map((arg) =>
		with0x(bytesToHex(serializeCVBytes(arg))),
	);

	const path = `/v2/contracts/call-read/${encodeURIComponent(address)}/${encodeURIComponent(name)}/${encodeURIComponent(params.functionName)}`;
	const data = await client.request(
		params.tip ? `${path}?tip=${encodeURIComponent(params.tip)}` : path,
		{
			method: "POST",
			body: {
				sender,
				arguments: serializedArgs,
			},
		},
	);

	if (data.okay) {
		if (typeof data.result !== "string") {
			throw new MalformedResponseError(
				`readContract: /v2/contracts/call-read response is missing "result"`,
			);
		}
		return deserializeCVBytes<T>(data.result);
	}
	throw new ReadContractError(data.cause ?? "Read-only call failed");
}
