import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../chains/definitions.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import type { Client } from "../../clients/types.ts";
import { custom } from "../../transports/custom.ts";
import { getPox5Activation, isPox5Active } from "../activation.ts";
import {
	bondPeriodToBurnHeight,
	bondPeriodToRewardCycle,
	bondPhaseAtHeight,
	bondUnlockCycle,
	burnHeightToRewardCycle,
	isInPreparePhase,
	rewardCycleToBurnHeight,
} from "../cycles.ts";
import {
	computeSignerGrantHash,
	signSignerGrant,
	verifySignerGrant,
} from "../grants.ts";
import { buildLockupAddress, buildLockupScript } from "../script.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));

// Mainnet-shaped chain params.
const POX = { firstBurnchainBlockHeight: 666_050, rewardCycleLength: 2_100 };
const BOND = { ...POX, firstBondPeriodCycle: 140 };

function poxClient(response: unknown): Client {
	const request = async (path: string) => {
		if (path.includes("/v2/pox")) return response;
		throw new Error(`unexpected path ${path}`);
	};
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request }),
	}) as unknown as Client;
}

describe("activation gate", () => {
	const withPox5 = (currentHeight: number) => ({
		current_burnchain_block_height: currentHeight,
		contract_versions: [
			{
				contract_id: "SP000000000000000000002Q6VF78.pox-4",
				activation_burnchain_block_height: 842_850,
				first_reward_cycle_id: 84,
			},
			{
				contract_id: "SP000000000000000000002Q6VF78.pox-5",
				activation_burnchain_block_height: 960_230,
				first_reward_cycle_id: 140,
			},
		],
	});

	it("reads pox-5 activation facts from contract_versions", async () => {
		const activation = await getPox5Activation(poxClient(withPox5(950_000)));
		expect(activation).toEqual({
			contractId: "SP000000000000000000002Q6VF78.pox-5",
			activationBurnchainBlockHeight: 960_230,
			firstRewardCycleId: 140,
		});
	});

	it("returns undefined on pre-4.0 nodes", async () => {
		const activation = await getPox5Activation(
			poxClient({ contract_versions: [] }),
		);
		expect(activation).toBeUndefined();
	});

	it("isPox5Active flips at the activation height", async () => {
		expect(await isPox5Active(poxClient(withPox5(960_229)))).toBe(false);
		expect(await isPox5Active(poxClient(withPox5(960_230)))).toBe(true);
	});
});

describe("cycle math", () => {
	it("round-trips burn heights and cycles", () => {
		const cycle = burnHeightToRewardCycle(960_230, POX);
		expect(rewardCycleToBurnHeight(cycle, POX)).toBeLessThanOrEqual(960_230);
		expect(rewardCycleToBurnHeight(cycle + 1, POX)).toBeGreaterThan(960_230);
	});

	it("bond periods start every BOND_GAP_CYCLES from the first bond cycle", () => {
		expect(bondPeriodToRewardCycle(0, BOND)).toBe(140);
		expect(bondPeriodToRewardCycle(1, BOND)).toBe(142);
		expect(bondPeriodToRewardCycle(5, BOND)).toBe(150);
		expect(bondUnlockCycle(0, BOND)).toBe(152);
		expect(bondPeriodToBurnHeight(1, BOND)).toBe(
			rewardCycleToBurnHeight(142, BOND),
		);
	});

	it("classifies bond phases", () => {
		const start = bondPeriodToBurnHeight(2, BOND);
		expect(bondPhaseAtHeight(2, start - 5 * 2_100, BOND)).toBe("too-early");
		expect(bondPhaseAtHeight(2, start - 2_100, BOND)).toBe("open");
		expect(bondPhaseAtHeight(2, start + 2_100, BOND)).toBe("locked");
		expect(bondPhaseAtHeight(2, start + 13 * 2_100, BOND)).toBe("unlocked");
	});

	it("detects prepare phase (final prepareCycleLength blocks)", () => {
		const params = { ...POX, prepareCycleLength: 100 };
		const cycleStart = rewardCycleToBurnHeight(150, POX);
		expect(isInPreparePhase(cycleStart, params)).toBe(false);
		expect(isInPreparePhase(cycleStart + 1_999, params)).toBe(false);
		expect(isInPreparePhase(cycleStart + 2_000, params)).toBe(true);
		expect(isInPreparePhase(cycleStart + 2_099, params)).toBe(true);
	});
});

describe("signer grants", () => {
	const OPTS = {
		signerManager: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-mgr",
		authId: 7n,
		chainId: 1,
	};

	it("sign → verify round-trips, RSV order", async () => {
		const sig = await signSignerGrant(ACCOUNT, OPTS);
		expect(sig).toMatch(/^[0-9a-f]{130}$/);
		expect(
			verifySignerGrant({
				...OPTS,
				publicKey: ACCOUNT.publicKey,
				signature: sig,
			}),
		).toBe(true);
	});

	it("rejects a wrong key, tampered message, and malformed sig", async () => {
		const sig = await signSignerGrant(ACCOUNT, OPTS);
		const other = privateKeyToAccount("22".repeat(32));
		expect(
			verifySignerGrant({
				...OPTS,
				publicKey: other.publicKey,
				signature: sig,
			}),
		).toBe(false);
		expect(
			verifySignerGrant({
				...OPTS,
				authId: 8n,
				publicKey: ACCOUNT.publicKey,
				signature: sig,
			}),
		).toBe(false);
		expect(
			verifySignerGrant({
				...OPTS,
				publicKey: ACCOUNT.publicKey,
				signature: "deadbeef",
			}),
		).toBe(false);
	});

	it("hash changes with each field (domain separation)", () => {
		const base = computeSignerGrantHash(OPTS);
		for (const variant of [
			{ ...OPTS, authId: 8n },
			{ ...OPTS, chainId: 0x80000000 },
			{
				...OPTS,
				signerManager: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.other",
			},
		]) {
			expect(computeSignerGrantHash(variant)).not.toEqual(base);
		}
	});
});

describe("lockup addresses", () => {
	const OPTS = {
		stxAddress: ACCOUNT.address,
		unlockBurnHeight: 985_430,
		stakerUnlockBytes: `21${"11".repeat(33)}ac`,
		earlyUnlockBytes: `21${"22".repeat(33)}ac`,
	};

	it("derives network-aware p2wsh addresses", () => {
		expect(buildLockupAddress(OPTS).startsWith("bc1q")).toBe(true);
		expect(buildLockupAddress(OPTS, "testnet").startsWith("tb1q")).toBe(true);
		expect(buildLockupAddress(OPTS, "regtest").startsWith("bcrt1q")).toBe(true);
	});

	it("script commits to the staker: different staker → different address", () => {
		const other = {
			...OPTS,
			stxAddress: privateKeyToAccount("22".repeat(32)).address,
		};
		expect(buildLockupAddress(OPTS)).not.toBe(buildLockupAddress(other));
		expect(buildLockupScript(OPTS)).not.toEqual(buildLockupScript(other));
	});

	it("rejects unlock heights Bitcoin would read as timestamps", () => {
		expect(() =>
			buildLockupScript({ ...OPTS, unlockBurnHeight: 500_000_000 }),
		).toThrow(/timestamp/);
	});
});
