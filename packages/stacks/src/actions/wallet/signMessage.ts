import { sha256 } from "@noble/hashes/sha2.js";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { structuredDataHash } from "../../clarity/structuredData.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { Cl } from "../../clarity/values.ts";
import type { Client } from "../../clients/types.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { isProviderAccount } from "./utils.ts";

export type SignMessageParams = {
	message: string | ClarityValue;
	domain?: {
		name: string;
		version: string;
		chainId: number;
	};
};

/** Sign a message. With `domain`, hashes per SIP-018; without, hashes the serialized CV. */
export async function signMessage(
	client: Client,
	params: SignMessageParams,
): Promise<string> {
	const account = client.account;
	if (!account) throw new Error("Account required");

	// Provider: delegate to wallet
	if (isProviderAccount(account)) {
		const method = params.domain
			? "stx_signStructuredMessage"
			: "stx_signMessage";
		const result = await account.provider.request(method, {
			message: params.message,
			domain: params.domain,
		});
		return result.signature;
	}

	const cv =
		typeof params.message === "string"
			? Cl.stringAscii(params.message)
			: params.message;

	const hash = params.domain
		? structuredDataHash({
				message: cv,
				domain: Cl.tuple({
					name: Cl.stringAscii(params.domain.name),
					version: Cl.stringAscii(params.domain.version),
					"chain-id": Cl.uint(params.domain.chainId),
				}),
			})
		: sha256(serializeCVBytes(cv));

	const sigBytes = await account.sign(hash);
	return bytesToHex(sigBytes);
}
