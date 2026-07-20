import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "@secondlayer/sdk";
import {
	bufferCV,
	contractPrincipalCV,
	falseCV,
	listCV,
	noneCV,
	serializeCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	trueCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import { POX5_CONTRACT_ID_MAINNET } from "@secondlayer/stacks/pox5";
import { decodePox5Print } from "./pox-5.ts";

const STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const SIGNER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const SIGNER_MANAGER = `${SIGNER}.signer-manager`;

function bytes(...values: number[]): Uint8Array {
	return new Uint8Array(values);
}

function buildPrintEvent(
	tuple: ReturnType<typeof tupleCV>,
	overrides: Partial<StreamsEvent> = {},
): StreamsEvent {
	return {
		cursor: "9000000:12",
		block_height: 9_000_000,
		block_hash: "0xblock",
		burn_block_height: 960_500,
		tx_id: "0xtx",
		tx_index: 4,
		event_index: 12,
		event_type: "print",
		contract_id: POX5_CONTRACT_ID_MAINNET,
		payload: {
			contract_id: POX5_CONTRACT_ID_MAINNET,
			topic: "print",
			value: { hex: serializeCV(tuple), repr: "(tuple ...)" },
		},
		ts: "2026-07-30T09:00:00.000Z",
		...overrides,
	} as StreamsEvent;
}

describe("decodePox5Print", () => {
	test("stake promotes staker, signer, amounts, and cycle window", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("stake"),
					signer: standardPrincipalCV(SIGNER),
					staker: standardPrincipalCV(STAKER),
					"amount-ustx": uintCV(5_000_000_000n),
					"num-cycles": uintCV(12n),
					"first-reward-cycle": uintCV(140n),
					"unlock-burn-height": uintCV(987_530n),
					"unlock-cycle": uintCV(152n),
				}),
			),
		);
		expect(row).not.toBeNull();
		expect(row?.topic).toBe("stake");
		expect(row?.staker).toBe(STAKER);
		expect(row?.signer).toBe(SIGNER);
		expect(row?.amount_ustx).toBe("5000000000");
		expect(row?.first_reward_cycle).toBe(140);
		expect(row?.unlock_cycle).toBe(152);
		expect(row?.unlock_burn_height).toBe(987_530);
		// Unpromoted fields stay reachable via data.
		expect((row?.data as Record<string, unknown>)["num-cycles"]).toBe("12");
	});

	test("register-for-bond keeps the l1 btc-lockup txid list in data", () => {
		const txid = bytes(...Array.from({ length: 32 }, (_, i) => i));
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("register-for-bond"),
					signer: standardPrincipalCV(SIGNER),
					staker: standardPrincipalCV(STAKER),
					"amount-ustx": uintCV(1_000_000n),
					"sats-total": uintCV(50_000_000n),
					"bond-index": uintCV(2n),
					"first-reward-cycle": uintCV(140n),
					"unlock-burn-height": uintCV(987_530n),
					"unlock-cycle": uintCV(152n),
					"is-l1-lock": trueCV(),
					"btc-lockup": tupleCV({
						type: stringAsciiCV("l1"),
						txs: someCV(
							listCV([
								tupleCV({
									txid: bufferCV(txid),
									"output-index": uintCV(1n),
								}),
							]),
						),
					}),
				}),
			),
		);
		expect(row?.amount_sats).toBe("50000000");
		expect(row?.bond_index).toBe(2);
		expect(row?.is_l1_lock).toBe(true);
		const lockup = (row?.data as Record<string, unknown>)["btc-lockup"] as {
			type: string;
			txs: Array<{ txid: string; "output-index": string }>;
		};
		expect(lockup.type).toBe("l1");
		expect(lockup.txs[0]?.txid).toMatch(/^0x[0-9a-f]{64}$/);
		expect(lockup.txs[0]?.["output-index"]).toBe("1");
	});

	test("register-for-bond l2 path decodes with txs none", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("register-for-bond"),
					signer: standardPrincipalCV(SIGNER),
					staker: standardPrincipalCV(STAKER),
					"amount-ustx": uintCV(1_000_000n),
					"sats-total": uintCV(25_000_000n),
					"bond-index": uintCV(3n),
					"first-reward-cycle": uintCV(141n),
					"unlock-burn-height": uintCV(989_630n),
					"unlock-cycle": uintCV(153n),
					"is-l1-lock": falseCV(),
					"btc-lockup": tupleCV({
						type: stringAsciiCV("l2"),
						txs: noneCV(),
					}),
				}),
			),
		);
		expect(row?.is_l1_lock).toBe(false);
		const lockup = (row?.data as Record<string, unknown>)["btc-lockup"] as {
			type: string;
			txs: unknown;
		};
		expect(lockup.txs).toBeNull();
	});

	test("fold-emitted add-to-allowlist rows keep their own event cursor", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("add-to-allowlist"),
					staker: standardPrincipalCV(STAKER),
					"max-sats": uintCV(100_000_000n),
					"bond-index": uintCV(2n),
				}),
				{ cursor: "9000000:13", event_index: 13 },
			),
		);
		expect(row?.cursor).toBe("9000000:13");
		expect(row?.event_index).toBe(13);
		expect(row?.staker).toBe(STAKER);
		expect(row?.bond_index).toBe(2);
		// max-sats is a cap, not a flow amount — stays in data only.
		expect(row?.amount_sats).toBeNull();
		expect((row?.data as Record<string, unknown>)["max-sats"]).toBe(
			"100000000",
		);
	});

	test("bond-distribution promotes bond_index and keeps per-sat rates in data", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("bond-distribution"),
					"bond-index": uintCV(1n),
					"target-yield": uintCV(500n),
					"bond-rewards": uintCV(123_456n),
					"bond-staked-sats": uintCV(75_000_000n),
					"accrued-rewards-per-sat": uintCV(42n),
					"cumulative-rewards-per-sat": uintCV(4200n),
				}),
			),
		);
		expect(row?.bond_index).toBe(1);
		expect(
			(row?.data as Record<string, unknown>)["cumulative-rewards-per-sat"],
		).toBe("4200");
	});

	test("claim-rewards promotes reward_cycle and signer_manager, nests bond list in data", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("claim-rewards"),
					"reward-cycle": uintCV(145n),
					"signer-manager": contractPrincipalCV(SIGNER, "signer-manager"),
					"stx-rewards": tupleCV({
						earned: uintCV(9_000n),
						"rewards-per-token": uintCV(3n),
					}),
					"bond-rewards": listCV([
						tupleCV({
							earned: uintCV(500n),
							"bond-index": uintCV(1n),
							"rewards-per-token": uintCV(2n),
						}),
					]),
					"bond-totals": uintCV(500n),
					"total-rewards": uintCV(9_500n),
				}),
			),
		);
		expect(row?.reward_cycle).toBe(145);
		expect(row?.signer_manager).toBe(SIGNER_MANAGER);
		const bondRewards = (row?.data as Record<string, unknown>)[
			"bond-rewards"
		] as Array<Record<string, unknown>>;
		expect(bondRewards[0]?.earned).toBe("500");
		expect(bondRewards[0]?.["bond-index"]).toBe("1");
	});

	test("claim-staker-rewards-for-signer unwraps optional bond-index", () => {
		const withBond = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("claim-staker-rewards-for-signer"),
					"signer-manager": contractPrincipalCV(SIGNER, "signer-manager"),
					staker: standardPrincipalCV(STAKER),
					"reward-cycle": uintCV(145n),
					"bond-index": someCV(uintCV(4n)),
					"rewards-claimed": uintCV(777n),
				}),
			),
		);
		expect(withBond?.bond_index).toBe(4);

		const stxOnly = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("claim-staker-rewards-for-signer"),
					"signer-manager": contractPrincipalCV(SIGNER, "signer-manager"),
					staker: standardPrincipalCV(STAKER),
					"reward-cycle": uintCV(145n),
					"bond-index": noneCV(),
					"rewards-claimed": uintCV(777n),
				}),
			),
		);
		expect(stxOnly?.bond_index).toBeNull();
	});

	test("unstake-sbtc maps amount-withdrawn-sats to amount_sats", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("unstake-sbtc"),
					staker: standardPrincipalCV(STAKER),
					signer: standardPrincipalCV(SIGNER),
					"bond-index": uintCV(2n),
					"amount-withdrawn-sats": uintCV(10_000_000n),
					"new-amount-sats": uintCV(40_000_000n),
				}),
			),
		);
		expect(row?.amount_sats).toBe("10000000");
		expect((row?.data as Record<string, unknown>)["new-amount-sats"]).toBe(
			"40000000",
		);
	});

	test("unstake promotes the shortened unlock window", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("unstake"),
					staker: standardPrincipalCV(STAKER),
					signer: standardPrincipalCV(SIGNER),
					"amount-ustx": uintCV(5_000_000_000n),
					"first-reward-cycle": uintCV(140n),
					"unlock-cycle": uintCV(147n),
					"unlock-burn-height": uintCV(977_030n),
				}),
			),
		);
		expect(row?.unlock_cycle).toBe(147);
		expect(row?.unlock_burn_height).toBe(977_030);
	});

	test("stake-update leaves the misnamed prev-unlock-height in data, unpromoted", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("stake-update"),
					"unlock-burn-height": uintCV(991_730n),
					staker: standardPrincipalCV(STAKER),
					signer: standardPrincipalCV(SIGNER),
					"old-signer": standardPrincipalCV(SIGNER),
					// Contract-side misnomer: this field carries a reward-CYCLE
					// number, not a burn height.
					"prev-unlock-height": uintCV(150n),
					"unlock-cycle": uintCV(154n),
					"num-cycles": uintCV(14n),
					"amount-ustx": uintCV(6_000_000_000n),
					"amount-increase": uintCV(1_000_000_000n),
					"cycles-to-extend": uintCV(2n),
				}),
			),
		);
		expect(row?.unlock_cycle).toBe(154);
		expect(row?.unlock_burn_height).toBe(991_730);
		expect((row?.data as Record<string, unknown>)["prev-unlock-height"]).toBe(
			"150",
		);
	});

	test("register-signer and grant lifecycle promote signer_key as hex", () => {
		const signerKey = bytes(...Array.from({ length: 33 }, (_, i) => i + 1));
		const registered = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("register-signer"),
					signer: standardPrincipalCV(SIGNER),
					"signer-key": bufferCV(signerKey),
				}),
			),
		);
		expect(registered?.signer).toBe(SIGNER);
		expect(registered?.signer_key).toMatch(/^0x[0-9a-f]{66}$/);

		const granted = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("grant-signer-key"),
					"signer-key": bufferCV(signerKey),
					"signer-manager": contractPrincipalCV(SIGNER, "signer-manager"),
					"auth-id": uintCV(99n),
				}),
			),
		);
		expect(granted?.signer_manager).toBe(SIGNER_MANAGER);
		expect(granted?.signer_key).toBe(registered?.signer_key ?? "");
	});

	test("admin topics decode with all promoted columns null", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("set-bond-admin"),
					"old-admin": standardPrincipalCV(STAKER),
					"new-admin": standardPrincipalCV(SIGNER),
				}),
			),
		);
		expect(row?.topic).toBe("set-bond-admin");
		expect(row?.staker).toBeNull();
		expect(row?.signer).toBeNull();
		expect((row?.data as Record<string, unknown>)["new-admin"]).toBe(SIGNER);
	});

	test("calculate-rewards keeps its cycle accounting in data only", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("calculate-rewards"),
					"bond-periods": listCV([uintCV(1n), uintCV(2n)]),
					"calculation-height": uintCV(9_000_000n),
					"gross-accrued-rewards": uintCV(1_000n),
					"total-bond-rewards": uintCV(400n),
					"reserve-deposit": uintCV(100n),
					"reserve-balance": uintCV(5_000n),
					"stx-cycle": uintCV(145n),
					"total-stx-staker-rewards": uintCV(500n),
					"cycle-staked-ustx": uintCV(9_999_999n),
					"accrued-rewards-per-ustx": uintCV(3n),
					"cumulative-rewards-per-ustx": uintCV(33n),
				}),
			),
		);
		expect(row?.reward_cycle).toBeNull();
		expect((row?.data as Record<string, unknown>)["stx-cycle"]).toBe("145");
		expect((row?.data as Record<string, unknown>)["bond-periods"]).toEqual([
			"1",
			"2",
		]);
	});

	test("unknown topic is skipped, not stored", () => {
		const row = decodePox5Print(
			buildPrintEvent(
				tupleCV({
					topic: stringAsciiCV("not-a-pox5-topic"),
					anything: uintCV(1n),
				}),
			),
		);
		expect(row).toBeNull();
	});

	test("non-tuple and topicless prints are skipped", () => {
		expect(
			decodePox5Print(
				buildPrintEvent(
					tupleCV({ "no-topic-key": uintCV(1n) }) as ReturnType<typeof tupleCV>,
				),
			),
		).toBeNull();
	});
});
