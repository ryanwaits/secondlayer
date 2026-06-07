import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import {
	AuthType,
	type ContractCallPayload,
	FungibleConditionCode,
	MEMO_MAX_LENGTH_BYTES,
	PostConditionModeWire,
	type SponsoredAuthorization,
	type TokenTransferPayload,
} from "../../transactions/types.ts";
import { deserializeTransaction } from "../../transactions/wire/deserialize.ts";
import { serializeTransactionHex } from "../../transactions/wire/serialize.ts";
import { buildExactTransfer } from "../build.ts";

const ORIGIN_KEY =
	"edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01";
const payer = privateKeyToAccount(ORIGIN_KEY);
const PAY_TO = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const SBTC_ID = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const NONCE = "x402-7f3a9c1e";

const base = {
	amount: 1000n,
	payTo: PAY_TO,
	payer: payer.address,
	payerPublicKey: payer.publicKey,
	accountNonce: 0n,
	nonce: NONCE,
};

describe("buildExactTransfer — STX", () => {
	const tx = buildExactTransfer({ ...base, asset: { kind: "stx" } });

	test("is a sponsored, fee-0, Deny-mode tx", () => {
		expect(tx.auth.authType).toBe(AuthType.Sponsored);
		expect(
			(tx.auth as SponsoredAuthorization).sponsorSpendingCondition,
		).toBeDefined();
		expect(tx.postConditionMode).toBe(PostConditionModeWire.Deny);
		// origin pays nothing — sponsor fills the fee in at settle
		expect(tx.auth.spendingCondition.fee).toBe(0n);
	});

	test("carries the challenge nonce in the memo", () => {
		expect((tx.payload as TokenTransferPayload).memo).toBe(NONCE);
	});

	test("pins exact amount leaving payer via an STX post-condition", () => {
		expect(tx.postConditions).toHaveLength(1);
		// biome-ignore lint/suspicious/noExplicitAny: post-condition wire shape varies by type
		const pc = tx.postConditions[0] as any;
		expect(pc.type).toBe("stx");
		expect(pc.conditionCode).toBe(FungibleConditionCode.Equal);
		expect(pc.amount).toBe(1000n);
		expect(pc.principal.address).toBe(payer.address);
	});
});

describe("buildExactTransfer — SIP-010 (sBTC)", () => {
	const tx = buildExactTransfer({
		...base,
		asset: { kind: "sip010", contractId: SBTC_ID, assetName: "sbtc-token" },
	});

	test("is a sponsored, fee-0, Deny-mode contract-call to transfer", () => {
		expect(tx.auth.authType).toBe(AuthType.Sponsored);
		expect(tx.postConditionMode).toBe(PostConditionModeWire.Deny);
		const payload = tx.payload as ContractCallPayload;
		expect(payload.contractAddress).toBe(
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
		);
		expect(payload.contractName).toBe("sbtc-token");
		expect(payload.functionName).toBe("transfer");
	});

	test("transfer args are (amount, sender=payer, recipient=payTo, some(memo))", () => {
		const args = (tx.payload as ContractCallPayload).functionArgs;
		expect(args).toHaveLength(4);
		expect(args[0]).toEqual({ type: "uint", value: 1000n });
		expect(args[1]).toMatchObject({ type: "address", value: payer.address });
		expect(args[2]).toMatchObject({ type: "address", value: PAY_TO });
		expect(args[3]?.type).toBe("some");
	});

	test("pins exact amount via an FT post-condition with the asset id", () => {
		// biome-ignore lint/suspicious/noExplicitAny: post-condition wire shape varies by type
		const pc = tx.postConditions[0] as any;
		expect(pc.type).toBe("ft");
		expect(pc.asset.address).toBe("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4");
		expect(pc.asset.contractName).toBe("sbtc-token");
		expect(pc.asset.assetName).toBe("sbtc-token");
		expect(pc.conditionCode).toBe(FungibleConditionCode.Equal);
	});
});

describe("buildExactTransfer — nonce budget + signing", () => {
	test("rejects a nonce over the 34-byte memo budget", () => {
		const tooLong = "x".repeat(MEMO_MAX_LENGTH_BYTES + 1);
		expect(() =>
			buildExactTransfer({ ...base, nonce: tooLong, asset: { kind: "stx" } }),
		).toThrow(/memo budget/);
	});

	test("origin-signs and round-trips through the hex the facilitator settles", async () => {
		const tx = buildExactTransfer({ ...base, asset: { kind: "stx" } });
		const signed = await signTransactionWithAccount(tx, payer);
		const hex = serializeTransactionHex(signed);
		const back = deserializeTransaction(hex);
		expect(back.auth.authType).toBe(AuthType.Sponsored);
		expect((back.payload as TokenTransferPayload).memo).toBe(NONCE);
	});
});
