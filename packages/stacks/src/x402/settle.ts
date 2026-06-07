import { sendTransaction } from "../actions/wallet/sendTransaction.ts";
import { sponsorTransaction } from "../actions/wallet/sponsorTransaction.ts";
import type { Client } from "../clients/types.ts";
import { deserializeTransaction } from "../transactions/wire/deserialize.ts";
import type { IntegerType } from "../utils/encoding.ts";

export type SponsorAndBroadcastOptions = {
	/** Override the sponsor fee (µSTX). Defaults to a fee estimate. */
	fee?: IntegerType;
	/** Override the sponsor account nonce. Defaults to the on-chain nonce. */
	nonce?: IntegerType;
};

export type SponsorAndBroadcastResult = {
	txid: string;
};

/**
 * Take an origin-signed, sponsored transfer (hex) from the payer, sponsor-sign
 * it with `client`'s account (paying the STX fee), and broadcast it.
 *
 * The payer never holds STX: they sign origin-only with fee `0`; this fills in
 * the sponsor spending condition + fee and POSTs to `/v2/transactions`. The
 * sponsor cannot grief the payer — amount/recipient/asset are pinned by the
 * origin signature + Deny-mode post-conditions baked into the tx.
 *
 * @param client a wallet client whose `account` is the funded sponsor signer.
 * @param signedTxHex the payer's origin-signed sponsored tx, hex-serialized.
 */
export async function sponsorAndBroadcast(
	client: Client,
	signedTxHex: string,
	options: SponsorAndBroadcastOptions = {},
): Promise<SponsorAndBroadcastResult> {
	const transaction = deserializeTransaction(signedTxHex);
	const sponsored = await sponsorTransaction(client, {
		transaction,
		fee: options.fee,
		nonce: options.nonce,
	});
	return sendTransaction(client, { transaction: sponsored });
}
