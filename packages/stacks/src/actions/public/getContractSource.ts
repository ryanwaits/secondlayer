import type { Client } from "../../clients/types.ts";
import { HttpRequestError } from "../../errors/http.ts";
import { parseContractId } from "../../utils/address.ts";

export type GetContractSourceParams = {
	contract: string; // "address.name"
};

export type ContractSourceResponse = {
	source: string;
	publish_height: number;
	marf_proof?: string;
};

/**
 * Fetch a deployed contract's Clarity source. Node-RPC only (`/v2/contracts/source`)
 * — not available through Hiro's extended API or a tenant proxy, so `client`
 * must be configured against a direct node transport. Returns `null` when the
 * node has no source for the contract.
 */
export async function getContractSource(
	client: Client,
	params: GetContractSourceParams,
): Promise<ContractSourceResponse | null> {
	const [address, name] = parseContractId(params.contract);
	try {
		const data = (await client.request(
			`/v2/contracts/source/${address}/${name}`,
			{ method: "GET" },
		)) as Partial<ContractSourceResponse> | undefined;
		return data?.source ? (data as ContractSourceResponse) : null;
	} catch (error) {
		if (error instanceof HttpRequestError && error.status === 404) return null;
		throw error;
	}
}
