import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import { buildContractCall } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { parseContractId } from "../../utils/address.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { broadcastWithNonceReset, resolveNonce } from "./nonceManager.ts";
import {
	type FeeParam,
	assertNoFeeTierForProvider,
	isFeeTier,
	isProviderAccount,
	resolveFee,
	setUnsignedFee,
} from "./utils.ts";

export type CallContractParams = {
	contract: string; // "address.name"
	functionName: string;
	functionArgs?: ClarityValue[];
	fee?: FeeParam;
	nonce?: IntegerType;
	postConditionMode?: "allow" | "deny";
	postConditions?: PostCondition[];
};

/** Build, sign, and broadcast a contract call */
export async function callContract(
	client: Client,
	params: CallContractParams,
): Promise<string> {
	const account = client.account;
	if (!account) throw new Error("Account required");

	// Validate the contract id up front so both the provider and local paths
	// reject malformed input instead of forwarding it to the wallet.
	const [contractAddress, contractName] = parseContractId(params.contract);

	// Provider: delegate to wallet
	if (isProviderAccount(account)) {
		assertNoFeeTierForProvider(params.fee);
		const result = await account.provider.request("stx_callContract", {
			contract: params.contract,
			functionName: params.functionName,
			functionArgs: params.functionArgs ?? [],
		});
		return result.txid;
	}

	// Local/Custom: build → sign → broadcast
	const nonce = params.nonce ?? (await resolveNonce(client, account.address));

	const needsFeeResolution = params.fee === undefined || isFeeTier(params.fee);

	const unsigned = buildContractCall({
		contractAddress,
		contractName,
		functionName: params.functionName,
		functionArgs: params.functionArgs ?? [],
		fee: needsFeeResolution ? 0n : (params.fee as IntegerType),
		nonce,
		publicKey: account.publicKey,
		chain: client.chain,
		postConditionMode: params.postConditionMode,
		postConditions: params.postConditions,
	});

	if (needsFeeResolution) {
		setUnsignedFee(unsigned, await resolveFee(client, unsigned, params.fee));
	}

	const signed = await signTransactionWithAccount(unsigned, account);
	return broadcastWithNonceReset(client, {
		transaction: signed,
		address: account.address,
	});
}
