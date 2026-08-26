import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";
import { parseContractId } from "../../utils/address.ts";

export type GetDataVarParams = {
	contract: string; // "address.name"
	varName: string;
};

export async function getDataVar<T extends ClarityValue = ClarityValue>(
	client: Client,
	params: GetDataVarParams,
): Promise<T> {
	const [address, name] = parseContractId(params.contract);
	const path = `/v2/data_var/${address}/${name}/${params.varName}?proof=0`;

	const data = await client.request(path, { method: "GET" });

	if (typeof data?.data !== "string") {
		throw new MalformedResponseError(
			`getDataVar: /v2/data_var/${address}/${name}/${params.varName} response is missing "data"`,
		);
	}
	return deserializeCVBytes<T>(data.data);
}
