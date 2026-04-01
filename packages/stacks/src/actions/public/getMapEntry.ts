import { deserializeCVBytes } from "../../clarity/deserialize.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import { parseContractId } from "../../utils/address.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";

export type GetMapEntryParams = {
	contract: string; // "address.name"
	mapName: string;
	key: ClarityValue;
};

export async function getMapEntry<T extends ClarityValue = ClarityValue>(
	client: Client,
	params: GetMapEntryParams,
): Promise<T> {
	const [address, name] = parseContractId(params.contract);
	const serializedKey = with0x(bytesToHex(serializeCVBytes(params.key)));

	const data = await client.request(
		`/v2/map_entry/${address}/${name}/${params.mapName}`,
		{
			method: "POST",
			body: serializedKey,
		},
	);

	return deserializeCVBytes<T>(data.data);
}
