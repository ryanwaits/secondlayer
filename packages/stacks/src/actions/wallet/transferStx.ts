import type { Client } from "../../clients/types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import { buildTokenTransfer } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { validateStacksAddress } from "../../utils/address.ts";
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

export type TransferStxParams = {
	to: string;
	amount: IntegerType;
	memo?: string;
	fee?: FeeParam;
	nonce?: IntegerType;
	postConditionMode?: "allow" | "deny";
	postConditions?: PostCondition[];
};

/** Build, sign, and broadcast an STX transfer */
export async function transferStx(
	client: Client,
	params: TransferStxParams,
): Promise<string> {
	const account = client.account;
	if (!account) throw new Error("Account required");

	if (!validateStacksAddress(params.to))
		throw new Error(`Invalid recipient address: ${params.to}`);

	// Provider: delegate to wallet
	if (isProviderAccount(account)) {
		assertNoFeeTierForProvider(params.fee);
		const result = await account.provider.request("stx_transferStx", {
			recipient: params.to,
			amount: String(params.amount),
			memo: params.memo,
		});
		return result.txid;
	}

	// Local/Custom: build → sign → broadcast
	const nonce = params.nonce ?? (await resolveNonce(client, account.address));

	const needsFeeResolution = params.fee === undefined || isFeeTier(params.fee);

	const unsigned = buildTokenTransfer({
		recipient: params.to,
		amount: params.amount,
		memo: params.memo,
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
