import { describe, expect, test } from "bun:test";
import {
	makeSTXTokenTransfer,
	sponsorTransaction as refSponsor,
} from "@stacks/transactions";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { testnet } from "../../chains/definitions.ts";
import { createSingleSigSpendingCondition } from "../authorization.ts";
import { buildTokenTransfer } from "../build.ts";
import { signSponsor, signTransaction } from "../signer.ts";
import type { SponsoredAuthorization } from "../types.ts";
import { serializeTransactionHex } from "../wire/serialize.ts";

/**
 * Reference-vector guard for sponsored-tx signing. Builds the SAME sponsored STX
 * transfer with our primitives and with @stacks/transactions (the implementation
 * Stacks nodes accept) and asserts byte-identical serialization. This is what the
 * old `sponsor.test.ts` couldn't catch: it only checked self-consistency, so a
 * wrong initial-sighash sentinel (signer = hash160(zero-pubkey) instead of 20
 * zero bytes) shipped a tx every node rejected with `SignatureValidation`.
 *
 * Compressed keys (33-byte, `01` suffix) are used so both libs pick the same
 * key-encoding and the comparison is a full byte match.
 */

// 33-byte (compressed) keys.
const ORIGIN_KEY =
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01";
const SPONSOR_KEY =
	"9888882b59abc471d140e5e0bb9c9109ae1ccf0a23b18fe3d20e3b5e12fb02e201";
const RECIPIENT = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";

const origin = privateKeyToAccount(ORIGIN_KEY, { addressVersion: 26 });
const sponsor = privateKeyToAccount(SPONSOR_KEY, { addressVersion: 26 });

function ours(): string {
	const tx = buildTokenTransfer({
		recipient: RECIPIENT,
		amount: 1000n,
		fee: 0n,
		nonce: 0n,
		publicKey: origin.publicKey,
		sponsored: true,
		chain: testnet,
	});
	const originSigned = signTransaction(tx, ORIGIN_KEY);
	const withSponsor = {
		...originSigned,
		auth: {
			...(originSigned.auth as SponsoredAuthorization),
			sponsorSpendingCondition: createSingleSigSpendingCondition(
				sponsor.publicKey,
				0n,
				180n,
			),
		},
	};
	return serializeTransactionHex(signSponsor(withSponsor, SPONSOR_KEY));
}

async function reference(): Promise<string> {
	const tx = await makeSTXTokenTransfer({
		recipient: RECIPIENT,
		amount: 1000n,
		fee: 0n,
		nonce: 0n,
		network: "testnet",
		senderKey: ORIGIN_KEY,
		sponsored: true,
	});
	const sponsored = await refSponsor({
		transaction: tx,
		sponsorPrivateKey: SPONSOR_KEY,
		fee: 180n,
		sponsorNonce: 0n,
		network: "testnet",
	});
	return sponsored.serialize();
}

describe("sponsored tx matches @stacks/transactions byte-for-byte", () => {
	test("origin + sponsor signatures + wire layout are identical to the reference", async () => {
		expect(ours()).toBe(await reference());
	});
});
