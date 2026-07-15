import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";

export type GetBalanceParams = {
	address: string;
};

export async function getBalance(
	client: Client,
	params: GetBalanceParams,
): Promise<bigint> {
	const data = await client.request(`/v2/accounts/${params.address}`, {
		method: "GET",
	});
	if (data?.balance === undefined) {
		throw new MalformedResponseError(
			`getBalance: /v2/accounts/${params.address} response is missing "balance"`,
		);
	}
	return BigInt(data.balance);
}
