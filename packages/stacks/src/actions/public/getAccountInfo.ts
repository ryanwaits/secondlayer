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
	if (data?.balance === undefined || data?.nonce === undefined) {
		throw new MalformedResponseError(
			`getAccountInfo: /v2/accounts/${params.address} response is missing "balance" or "nonce"`,
		);
	}
	return {
		balance: BigInt(data.balance),
		nonce: BigInt(data.nonce),
		balanceProof: data.balance_proof ?? "",
		nonceProof: data.nonce_proof ?? "",
	};
}
