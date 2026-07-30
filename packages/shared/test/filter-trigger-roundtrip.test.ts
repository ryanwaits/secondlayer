import { describe, expect, test } from "bun:test";
import { on } from "@secondlayer/stacks/filters";
import { ChainTriggerSchema } from "../src/schemas/subscriptions.ts";

/**
 * CI gate: the canonical filter vocabulary must project to triggers the
 * server actually accepts. `ChainTriggerSchema` members are `.strict()` —
 * one wrong field name or an unstripped `abi`/`prints` and the subscription
 * silently stops matching. Every member is exercised with EVERY field set.
 */

const ALICE = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BOB = "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K";
const CONTRACT = "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc";
const ASSET = `${CONTRACT}::aeUSDC`;

const EVERY_MEMBER = [
	on.stxTransfer({
		sender: ALICE,
		recipient: BOB,
		minAmount: 1n,
		maxAmount: 340282366920938463463374607431768211455n, // uint128 max
	}),
	on.stxMint({ recipient: BOB, minAmount: 1n }),
	on.stxBurn({ sender: ALICE, minAmount: 1n }),
	on.stxLock({ lockedAddress: ALICE, minAmount: 1n }),
	on.ftTransfer({
		assetIdentifier: ASSET,
		sender: ALICE,
		recipient: BOB,
		minAmount: 1_000_000n,
		trait: "sip-010",
	}),
	on.ftMint({
		assetIdentifier: ASSET,
		recipient: BOB,
		minAmount: 1n,
		trait: "sip-010",
	}),
	on.ftBurn({
		assetIdentifier: ASSET,
		sender: ALICE,
		minAmount: 1n,
		trait: "sip-010",
	}),
	on.nftTransfer({
		assetIdentifier: ASSET,
		sender: ALICE,
		recipient: BOB,
		trait: "sip-009",
	}),
	on.nftMint({ assetIdentifier: ASSET, recipient: BOB, trait: "sip-009" }),
	on.nftBurn({ assetIdentifier: ASSET, sender: ALICE, trait: "sip-009" }),
	on.contractCall({
		contractId: CONTRACT,
		functionName: "transfer",
		caller: ALICE,
		trait: "sip-010",
	}),
	on.contractDeploy({ deployer: ALICE, contractName: "my-token" }),
	on.print({ contractId: CONTRACT, topic: "transfer", trait: "sip-010" }),
	on.sbtcDeposit({
		sender: ALICE,
		minAmount: 1n,
		maxAmount: 100_000_000n,
		bitcoinTxid:
			"0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
		requestId: 7,
	}),
	on.sbtcWithdrawalCreate({
		sender: ALICE,
		minAmount: 1n,
		maxAmount: 2n,
		requestId: 7,
	}),
	on.sbtcWithdrawalAccept({ requestId: 7, sweepTxid: "0xabc123" }),
	on.sbtcWithdrawalReject({ requestId: 7 }),
	on.sbtcWithdrawalSweptConfirmed({ requestId: 7, sweepTxid: "0xabc123" }),
];

describe("filter → trigger round-trip (CI gate)", () => {
	test("every member with every field set satisfies the strict server schema", () => {
		for (const filter of EVERY_MEMBER) {
			const trigger = filter.toChainTrigger();
			const parsed = ChainTriggerSchema.safeParse(trigger);
			expect(
				parsed.success,
				`member ${filter.type}: ${JSON.stringify(parsed.success ? "" : parsed.error.issues)}`,
			).toBe(true);
		}
	});

	test("wildcard patterns survive the trigger projection (Subscriptions-only feature)", () => {
		const trigger = on
			.ftTransfer({ assetIdentifier: `${CONTRACT}::*`, sender: "SP2QEZ*" })
			.toChainTrigger();
		expect(ChainTriggerSchema.safeParse(trigger).success).toBe(true);
	});

	test("bigint amounts arrive as JSON-safe strings, never bigint", () => {
		for (const filter of EVERY_MEMBER) {
			const trigger = filter.toChainTrigger();
			// The whole point of the explicit projection: JSON.stringify cannot
			// throw on a trigger (the spread-a-bigint bug this design kills).
			expect(() => JSON.stringify(trigger)).not.toThrow();
			for (const value of Object.values(trigger)) {
				expect(typeof value).not.toBe("bigint");
			}
		}
	});
});
