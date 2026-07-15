import type { Client } from "../../clients/types.ts";
import { createSingleSigSpendingCondition } from "../../transactions/authorization.ts";
import { signSponsorWithAccount } from "../../transactions/signer.ts";
import {
	AuthType,
	type SponsoredAuthorization,
	type StacksTransaction,
} from "../../transactions/types.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { intToBigInt } from "../../utils/encoding.ts";
import { resolveNonce } from "./nonceManager.ts";
import { type FeeParam, isProviderAccount, resolveFee } from "./utils.ts";

export type SponsorTransactionParams = {
	transaction: StacksTransaction;
	fee?: FeeParam;
	nonce?: IntegerType;
};

/** Sponsor a transaction: set sponsor spending condition, sign as sponsor */
export async function sponsorTransaction(
	client: Client,
	params: SponsorTransactionParams,
): Promise<StacksTransaction> {
	const { transaction } = params;

	if (transaction.auth.authType !== AuthType.Sponsored) {
		throw new Error("Transaction must have sponsored authorization");
	}

	const account = client.account;
	if (!account) throw new Error("Account required");
	if (isProviderAccount(account)) {
		throw new Error("Provider accounts cannot sponsor transactions");
	}

	// Resolve sponsor nonce
	const nonce =
		params.nonce != null
			? intToBigInt(params.nonce)
			: await resolveNonce(client, account.address);

	// Resolve sponsor fee. Estimation failure falls back to the minimum relay
	// fee instead of 0 (a 0-fee tx would be rejected at broadcast).
	const fee = await resolveFee(client, transaction, params.fee);

	// Create sponsor spending condition
	const sponsorCondition = createSingleSigSpendingCondition(
		account.publicKey,
		nonce,
		fee,
	);

	// Set sponsor spending condition on the tx
	const auth = transaction.auth as SponsoredAuthorization;
	const sponsored: StacksTransaction = {
		...transaction,
		auth: {
			...auth,
			sponsorSpendingCondition: sponsorCondition,
		},
	};

	// Sign as sponsor
	return signSponsorWithAccount(sponsored, account);
}
