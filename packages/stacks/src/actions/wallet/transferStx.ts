import type { Client } from "../../clients/types.ts";
import type {
	PostConditionInput,
	PostConditionMode,
} from "../../postconditions/types.ts";
import { buildTokenTransfer } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { validateStacksAddress } from "../../utils/address.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import {
	broadcastWithNonceReset,
	releaseNonce,
	resolveNonce,
} from "./nonceManager.ts";
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
	postConditionMode?: PostConditionMode;
	postConditions?: PostConditionInput[];
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
	const managed =
		params.nonce === undefined && client.nonceManager !== undefined;
	const nonce = params.nonce ?? (await resolveNonce(client, account.address));

	try {
		const needsFeeResolution =
			params.fee === undefined || isFeeTier(params.fee);

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
			const { fee } = await resolveFee(client, unsigned, params.fee);
			setUnsignedFee(unsigned, fee);
		}

		const signed = await signTransactionWithAccount(unsigned, account);
		return await broadcastWithNonceReset(client, {
			transaction: signed,
			address: account.address,
		});
	} catch (error) {
		// Anything that fails between reserving the nonce and a 2xx broadcast
		// (fee estimate, signing, FeeTooLow, transport) never reached the
		// mempool: hand the nonce back so the next send does not skip it.
		if (managed) await releaseNonce(client, account.address, nonce as bigint);
		throw error;
	}
}
