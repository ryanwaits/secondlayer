import type { Client } from "../../clients/types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import { buildContractDeploy } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import type { ClarityVersion } from "../../transactions/types.ts";
import { isClarityName } from "../../utils/address.ts";
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

export type DeployContractParams = {
	contractName: string;
	codeBody: string;
	clarityVersion?: ClarityVersion;
	fee?: FeeParam;
	nonce?: IntegerType;
	postConditionMode?: "allow" | "deny";
	postConditions?: PostCondition[];
};

/** Build, sign, and broadcast a contract deploy */
export async function deployContract(
	client: Client,
	params: DeployContractParams,
): Promise<string> {
	const account = client.account;
	if (!account) throw new Error("Account required");

	if (!isClarityName(params.contractName))
		throw new Error(`Invalid contract name: ${params.contractName}`);

	// Provider: delegate to wallet
	if (isProviderAccount(account)) {
		assertNoFeeTierForProvider(params.fee);
		const result = await account.provider.request("stx_deployContract", {
			contractName: params.contractName,
			codeBody: params.codeBody,
			clarityVersion: params.clarityVersion,
		});
		return result.txid;
	}

	// Local/Custom: build → sign → broadcast
	const nonce = params.nonce ?? (await resolveNonce(client, account.address));

	const needsFeeResolution = params.fee === undefined || isFeeTier(params.fee);

	const unsigned = buildContractDeploy({
		contractName: params.contractName,
		codeBody: params.codeBody,
		clarityVersion: params.clarityVersion,
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
