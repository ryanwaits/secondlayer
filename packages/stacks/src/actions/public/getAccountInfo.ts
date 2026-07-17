import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";

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
	params: GetAccountInfoParams,
): Promise<AccountInfo> {
	const data = await client.request(`/v2/accounts/${params.address}?proof=1`, {
		method: "GET",
	});
	const balance = (data as { balance?: unknown })?.balance;
	const nonce = (data as { nonce?: unknown })?.nonce;
	if (
		(typeof balance !== "string" && typeof balance !== "number") ||
		(typeof nonce !== "string" && typeof nonce !== "number")
	) {
		throw new MalformedResponseError(
			`getAccountInfo: /v2/accounts/${params.address} response is missing "balance" or "nonce"`,
		);
	}
	return {
		balance: BigInt(balance),
		nonce: BigInt(nonce),
		balanceProof: data.balance_proof ?? "",
		nonceProof: data.nonce_proof ?? "",
	};
}
