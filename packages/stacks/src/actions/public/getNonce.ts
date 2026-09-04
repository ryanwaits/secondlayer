import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";

export type GetNonceParams = {
	address: string;
};

export type GetNonceResult = {
	nonce: bigint;
	possibleNextNonce: bigint;
};

export async function getNonce(
	client: Client,
	params: GetNonceParams,
): Promise<bigint> {
	const data = await client.request(
		`/v2/accounts/${encodeURIComponent(params.address)}`,
		{ method: "GET" },
	);
	const nonce = (data as { nonce?: unknown })?.nonce;
	if (typeof nonce !== "number" && typeof nonce !== "string") {
		throw new MalformedResponseError(
			`getNonce: /v2/accounts/${params.address} response is missing "nonce"`,
		);
	}
	return BigInt(nonce);
}
