import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { mainnet } from "../../chains/definitions.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { Cl } from "../../clarity/values.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import type { Client } from "../../clients/types.ts";
import { custom } from "../../transports/custom.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";
import {
	eligibleClaimRewards,
	eligibleGrantSignerKey,
	eligiblePauseRewards,
	eligibleRegisterForBond,
	eligibleSetBondAdmin,
	eligibleStake,
	eligibleUnstake,
	eligibleUnstakeSbtc,
} from "../eligibility.ts";
import { Pox5ErrorCode } from "../errors.ts";

const ACCOUNT = privateKeyToAccount("11".repeat(32));
const STAKER = ACCOUNT.address;
const SIGNER_MGR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-mgr";
const ADMIN = "SP72DMR3MJKS7RVBY33JVV7EEJSQ1PYDVKDP10FX";
const SIGNER_KEY = (() => {
	const key = new Uint8Array(33);
	key[0] = 0x02;
	return key;
})();

const POX_OK = {
	current_burnchain_block_height: 960_230,
	first_burnchain_block_height: 666_050,
	reward_cycle_length: 2_100,
	prepare_cycle_length: 100,
	contract_versions: [
		{
			contract_id: "SP000000000000000000002Q6VF78.pox-5",
			activation_burnchain_block_height: 960_230,
			first_reward_cycle_id: 140,
		},
	],
};

/** Last 100 blocks of cycle 140 — prepare phase. */
const POX_PREPARE = {
	...POX_OK,
	current_burnchain_block_height: 962_050,
};

function hexCv(cv: ClarityValue): string {
	return with0x(bytesToHex(serializeCVBytes(cv)));
}

function defaultRead(fn: string): ClarityValue {
	switch (fn) {
		case "get-staker-info":
		case "get-bond-membership":
			return Cl.none();
		case "get-signer-info":
			return Cl.some(Cl.buffer(SIGNER_KEY));
		case "verify-signer-key-grant":
			return Cl.ok(Cl.bool(true));
		case "current-pox-reward-cycle":
		case "get-first-pox-5-reward-cycle":
			return Cl.uint(140);
		case "get-earned":
			return Cl.uint(1);
		case "get-protocol-bond":
			return Cl.some(
				Cl.tuple({
					"early-unlock-bytes": Cl.buffer(new Uint8Array([0x51])),
					"min-ustx-ratio": Cl.uint(5_000),
					"stx-value-ratio": Cl.uint(12_000),
					"target-rate": Cl.uint(500),
				}),
			);
		case "get-bond-allowance":
			return Cl.some(Cl.uint(10n ** 12n));
		case "get-bond-l1-unlock-height":
			return Cl.uint(900_000);
		case "get-staker-custodied-sbtc":
			return Cl.uint(0);
		case "has-announced-l1-early-exit":
			return Cl.bool(false);
		default:
			throw new Error(`unmocked read ${fn}`);
	}
}

function defaultDataVar(varName: string): ClarityValue {
	switch (varName) {
		case "rewards-paused":
			return Cl.bool(false);
		case "bond-admin":
		case "pause-admin":
			return Cl.principal(ADMIN);
		default:
			throw new Error(`unmocked data var ${varName}`);
	}
}

function mockClient(opts?: {
	pox?: Record<string, unknown>;
	reads?: Record<string, ClarityValue>;
	dataVars?: Record<string, ClarityValue>;
	maps?: Record<string, ClarityValue>;
	balance?: bigint;
}): Client {
	const pox = opts?.pox ?? POX_OK;
	const request = async (path: string) => {
		if (path.includes("/v2/pox")) return pox;
		if (path.includes("/v2/data_var/")) {
			const varName = path.split("/").pop()?.split("?")[0] ?? "";
			const cv = opts?.dataVars?.[varName] ?? defaultDataVar(varName);
			return { data: hexCv(cv) };
		}
		if (path.includes("/v2/map_entry/")) {
			const mapName = path.split("/").pop() ?? "";
			const cv = opts?.maps?.[mapName] ?? Cl.none();
			return { data: hexCv(cv) };
		}
		if (path.includes("/v2/accounts/")) {
			return { balance: String(opts?.balance ?? 10n ** 18n) };
		}
		if (path.includes("/v2/contracts/call-read/")) {
			const fn = path.split("/").pop() ?? "";
			const cv = opts?.reads?.[fn] ?? defaultRead(fn);
			return { okay: true, result: hexCv(cv) };
		}
		throw new Error(`unexpected path ${path}`);
	};
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request }),
	}) as unknown as Client;
}

const STAKE = {
	staker: STAKER,
	signerManager: SIGNER_MGR,
	amountUstx: 100_000_000_000n,
	numCycles: 12,
	startBurnHeight: 960_231,
};

describe("eligibleStake", () => {
	it("all-clear path → { ok: true }", async () => {
		expect(await eligibleStake(mockClient(), STAKE)).toEqual({ ok: true });
	});

	it("stake during prepare → StakeInPreparePhase", async () => {
		const result = await eligibleStake(mockClient({ pox: POX_PREPARE }), STAKE);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
	});

	it("already staked (getStakerInfo non-null) → AlreadyStaked", async () => {
		const result = await eligibleStake(
			mockClient({
				reads: {
					"get-staker-info": Cl.some(
						Cl.tuple({
							"amount-ustx": Cl.uint(100_000_000_000n),
							"first-reward-cycle": Cl.uint(140),
							"num-cycles": Cl.uint(12),
							signer: Cl.principal(SIGNER_MGR),
						}),
					),
				},
			}),
			STAKE,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.AlreadyStaked);
	});

	it("collects every reason (prepare + already staked)", async () => {
		const result = await eligibleStake(
			mockClient({
				pox: POX_PREPARE,
				reads: {
					"get-staker-info": Cl.some(
						Cl.tuple({
							"amount-ustx": Cl.uint(1),
							"first-reward-cycle": Cl.uint(140),
							"num-cycles": Cl.uint(12),
							signer: Cl.principal(SIGNER_MGR),
						}),
					),
				},
			}),
			STAKE,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
		expect(result.reasons).toContain(Pox5ErrorCode.AlreadyStaked);
	});
});

describe("eligibleRegisterForBond", () => {
	it("empty l1Outputs + no sbtcSats → not ok", async () => {
		const result = await eligibleRegisterForBond(mockClient(), {
			staker: STAKER,
			bondIndex: 0,
			signerManager: SIGNER_MGR,
			amountUstx: 100_000_000_000n,
			btcLockup: { l1Outputs: [], stakerUnlockBytes: "00" },
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.InvalidLockupAmount);
	});

	it("sBTC path all-clear", async () => {
		expect(
			await eligibleRegisterForBond(mockClient(), {
				staker: STAKER,
				bondIndex: 1,
				signerManager: SIGNER_MGR,
				amountUstx: 100_000_000_000n,
				btcLockup: { sbtcSats: 1_000_000n },
			}),
		).toEqual({ ok: true });
	});
});

describe("eligibleClaimRewards", () => {
	it("rewards-paused data-var true → RewardsPaused", async () => {
		const result = await eligibleClaimRewards(
			mockClient({ dataVars: { "rewards-paused": Cl.bool(true) } }),
			{ signer: SIGNER_MGR, rewardCycle: 140 },
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.RewardsPaused);
	});

	it("zero earned → NoClaimableRewards", async () => {
		const result = await eligibleClaimRewards(
			mockClient({ reads: { "get-earned": Cl.uint(0) } }),
			{ signer: SIGNER_MGR, rewardCycle: 140 },
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.NoClaimableRewards);
	});
});

describe("eligibleUnstake / eligibleUnstakeSbtc", () => {
	it("unstake during prepare → UnstakeInPreparePhase", async () => {
		const result = await eligibleUnstake(mockClient({ pox: POX_PREPARE }), {
			staker: STAKER,
			oldSignerManager: SIGNER_MGR,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.UnstakeInPreparePhase);
	});

	it("unstake-sbtc during prepare → StakeInPreparePhase", async () => {
		const result = await eligibleUnstakeSbtc(mockClient({ pox: POX_PREPARE }), {
			staker: STAKER,
			signerManager: SIGNER_MGR,
			amountSats: 1,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
	});
});

describe("eligibleGrantSignerKey / admin", () => {
	it("grant already used → SignerKeyGrantUsed", async () => {
		const result = await eligibleGrantSignerKey(
			mockClient({
				maps: { "used-signer-key-grants": Cl.some(Cl.bool(true)) },
			}),
			{ signerKey: SIGNER_KEY, signerManager: SIGNER_MGR, authId: 7 },
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.SignerKeyGrantUsed);
	});

	it("set-bond-admin wrong caller → Unauthorized", async () => {
		const result = await eligibleSetBondAdmin(mockClient(), {
			caller: STAKER,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not ok");
		expect(result.reasons).toContain(Pox5ErrorCode.Unauthorized);
	});

	it("pause-rewards matching pause-admin → ok", async () => {
		expect(await eligiblePauseRewards(mockClient(), { caller: ADMIN })).toEqual(
			{ ok: true },
		);
	});
});
