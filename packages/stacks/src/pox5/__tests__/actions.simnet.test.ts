import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../chains/definitions.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { createWalletClient } from "../../clients/createWalletClient.ts";
import type { Client } from "../../clients/types.ts";
import type { ContractCallPayload } from "../../transactions/types.ts";
import { deserializeTransaction } from "../../transactions/wire/deserialize.ts";
import { custom } from "../../transports/custom.ts";
import { hexToBytes } from "../../utils/encoding.ts";
import { pox5 } from "../extension.ts";

// Pins every pox5 wallet action against the ACTUAL boot contract interface:
// each action runs through the real callContract path (build → sign →
// broadcast), the broadcast transaction is decoded, and the called function's
// name, arity, and argument type-tags are validated against the pox-5
// interface Clarinet ships for Epoch 4.0. A renamed function, reordered or
// retyped argument upstream fails this suite.

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);
const POX5_ID = "SP000000000000000000002Q6VF78.pox-5";
const ACCOUNT = privateKeyToAccount("11".repeat(32));
const TXID = `0x${"ab".repeat(32)}`;
const SIGNER_MGR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-mgr";

// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
let iface: any;
let captured: ContractCallPayload[];
let client: Client & { pox5: ReturnType<ReturnType<typeof pox5>>["pox5"] };

beforeAll(async () => {
	const simnet: Simnet = await initSimnet(MANIFEST);
	iface = simnet.getContractsInterfaces().get(POX5_ID);
	expect(iface).toBeDefined();

	captured = [];
	const request = async (
		path: string,
		// biome-ignore lint/suspicious/noExplicitAny: test transport stub
		options?: any,
	) => {
		if (path.includes("/v2/accounts/")) return { nonce: 0 };
		if (path.includes("/v2/fees/")) return { estimations: [{ fee: 200 }] };
		if (path.includes("/v2/transactions")) {
			const tx = deserializeTransaction(hexToBytes(options.body.tx));
			captured.push(tx.payload as ContractCallPayload);
			return TXID;
		}
		throw new Error(`unexpected path ${path}`);
	};
	client = createWalletClient({
		chain: mainnet,
		account: ACCOUNT,
		transport: custom({ request }),
	}).extend(pox5()) as unknown as typeof client;
});

/** Map one of our wire CVs to the Clarity-interface type family it satisfies. */
function cvMatchesIfaceType(cv: ClarityValue, type: unknown): boolean {
	if (type === "uint128") return cv.type === "uint";
	if (type === "principal" || type === "trait_reference")
		return cv.type === "address" || cv.type === "contract";
	if (typeof type === "object" && type !== null) {
		const t = type as Record<string, unknown>;
		if ("buffer" in t) return cv.type === "buffer";
		if ("optional" in t)
			return (
				cv.type === "none" ||
				(cv.type === "some" &&
					// biome-ignore lint/suspicious/noExplicitAny: recursive unwrap
					cvMatchesIfaceType((cv as any).value, t.optional))
			);
		if ("list" in t) return cv.type === "list";
		if ("tuple" in t) return cv.type === "tuple";
		if ("response" in t) return cv.type === "ok" || cv.type === "err";
	}
	return false;
}

async function assertPinned(fnName: string, invoke: () => Promise<string>) {
	const before = captured.length;
	const txid = await invoke();
	expect(txid).toBe(TXID);
	const payload = captured[before] as ContractCallPayload;
	expect(payload.functionName).toBe(fnName);

	// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
	const fn = iface.functions.find((f: any) => f.name === fnName);
	expect(fn).toBeDefined();
	expect(fn.access).toBe("public");
	expect(payload.functionArgs.length).toBe(fn.args.length);
	fn.args.forEach(
		// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
		(arg: any, i: number) => {
			const cv = payload.functionArgs[i] as ClarityValue;
			if (!cvMatchesIfaceType(cv, arg.type)) {
				throw new Error(
					`${fnName} arg ${i} (${arg.name}): our CV type '${cv.type}' does not satisfy interface type ${JSON.stringify(arg.type)}`,
				);
			}
		},
	);
}

describe("pox5 wallet actions match the boot contract interface", () => {
	test("setup-bond", () =>
		assertPinned("setup-bond", () =>
			client.pox5.setupBond({
				bondIndex: 0,
				targetRate: 500,
				stxValueRatio: 12_000,
				minUstxRatio: 5_000,
				earlyUnlockBytes: `21${"22".repeat(33)}ac`,
				allowlist: [{ staker: ACCOUNT.address, maxSats: 1_000_000n }],
			}),
		));

	test("register-for-bond — sBTC path", () =>
		assertPinned("register-for-bond", () =>
			client.pox5.registerForBond({
				bondIndex: 0,
				signerManager: SIGNER_MGR,
				amountUstx: 100_000_000_000n,
				btcLockup: { sbtcSats: 1_000_000n },
			}),
		));

	test("register-for-bond — L1 lockup path", () =>
		assertPinned("register-for-bond", () =>
			client.pox5.registerForBond({
				bondIndex: 0,
				signerManager: SIGNER_MGR,
				amountUstx: 100_000_000_000n,
				btcLockup: {
					l1Outputs: [
						{
							height: 960_500,
							tx: "00".repeat(200),
							outputIndex: 0,
							header: "00".repeat(80),
							leafHashes: ["11".repeat(32), "22".repeat(32)],
							txCount: 4,
							txIndex: 1,
							amount: 1_000_000n,
							unlockBurnHeight: 985_430,
						},
					],
					stakerUnlockBytes: `21${"11".repeat(33)}ac`,
				},
				signerCalldata: "aa".repeat(10),
			}),
		));

	test("update-bond-registration", () =>
		assertPinned("update-bond-registration", () =>
			client.pox5.updateBondRegistration({
				signerManager: SIGNER_MGR,
				oldSignerManager: SIGNER_MGR,
			}),
		));

	test("stake", () =>
		assertPinned("stake", () =>
			client.pox5.stake({
				signerManager: SIGNER_MGR,
				amountUstx: 100_000_000_000n,
				numCycles: 12,
				startBurnHeight: 960_231,
			}),
		));

	test("stake-update", () =>
		assertPinned("stake-update", () =>
			client.pox5.stakeUpdate({
				signerManager: SIGNER_MGR,
				oldSignerManager: SIGNER_MGR,
				cyclesToExtend: 6,
				amountIncrease: 0,
			}),
		));

	test("unstake", () =>
		assertPinned("unstake", () =>
			client.pox5.unstake({ oldSignerManager: SIGNER_MGR }),
		));

	test("unstake-sbtc", () =>
		assertPinned("unstake-sbtc", () =>
			client.pox5.unstakeSbtc({
				signerManager: SIGNER_MGR,
				amountSats: 500_000n,
			}),
		));

	test("announce-l1-early-exit", () =>
		assertPinned("announce-l1-early-exit", () =>
			client.pox5.announceL1EarlyExit({
				staker: ACCOUNT.address,
				oldSignerManager: SIGNER_MGR,
			}),
		));

	test("calculate-rewards", () =>
		assertPinned("calculate-rewards", () =>
			client.pox5.calculateRewards({ bondPeriods: [0, 1, 2] }),
		));

	test("claim-rewards", () =>
		assertPinned("claim-rewards", () =>
			client.pox5.claimRewards({ bondPeriods: [0], rewardCycle: 150 }),
		));

	test("claim-staker-rewards-for-signer", () =>
		assertPinned("claim-staker-rewards-for-signer", () =>
			client.pox5.claimStakerRewardsForSigner({
				staker: ACCOUNT.address,
				rewardCycle: 150,
				bondIndex: 0,
			}),
		));

	test("grant-signer-key", () =>
		assertPinned("grant-signer-key", () =>
			client.pox5.grantSignerKey({
				signerKey: `02${"11".repeat(32)}`,
				signerManager: SIGNER_MGR,
				authId: 1,
				signerSig: "00".repeat(65),
			}),
		));

	test("revoke-signer-grant", () =>
		assertPinned("revoke-signer-grant", () =>
			client.pox5.revokeSignerGrant({
				signerManager: SIGNER_MGR,
				signerKey: `02${"11".repeat(32)}`,
			}),
		));
});

describe("pox5 reads match the boot contract interface", () => {
	const READS: Array<[string, number]> = [
		["get-staker-info", 1],
		["get-bond-membership", 1],
		["get-protocol-bond", 1],
		["get-bond-allowance", 2],
		["get-total-sbtc-staked-for-bond", 1],
		["get-staker-custodied-sbtc", 1],
		["has-announced-l1-early-exit", 2],
		["get-bond-l1-unlock-height", 1],
		["get-signer-info", 1],
		["verify-signer-key-grant", 2],
		["current-pox-reward-cycle", 0],
		["get-first-pox-5-reward-cycle", 0],
	];

	test("every wrapped read exists as read_only with the expected arity", () => {
		for (const [name, arity] of READS) {
			// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
			const fn = iface.functions.find((f: any) => f.name === name);
			if (!fn) throw new Error(`read-only ${name} missing from pox-5`);
			expect(fn.access).toBe("read_only");
			expect(fn.args.length).toBe(arity);
		}
	});
});
