import type { Client } from "../../clients/types.ts";

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
	const data = await client.request(`/v2/accounts/${params.address}`, {
		method: "GET",
	});
	const nonce = (data as { nonce?: unknown })?.nonce;
	if (typeof nonce !== "number" && typeof nonce !== "string") {
		throw new Error(
			`getNonce: unexpected /v2/accounts response for ${params.address} (missing numeric nonce)`,
		);
	}
	return BigInt(nonce);
}
