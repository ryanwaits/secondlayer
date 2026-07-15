import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";

export async function getBlockHeight(client: Client): Promise<number> {
	const data = await client.request("/v2/info", { method: "GET" });
	if (typeof data?.stacks_tip_height !== "number") {
		throw new MalformedResponseError(
			'getBlockHeight: /v2/info response is missing "stacks_tip_height"',
		);
	}
	return data.stacks_tip_height;
}
