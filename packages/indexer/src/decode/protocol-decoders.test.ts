import { beforeEach, describe, expect, test } from "bun:test";
import { blockEndCursor, encodeStreamsCursor } from "@secondlayer/shared";
import { getDb, sql } from "@secondlayer/shared/db";
import type { StreamsEvent } from "@secondlayer/shared/streams-rows";
import {
	bufferCV,
	noneCV,
	serializeCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import { SBTC_ASSET_IDENTIFIER_MAINNET } from "@secondlayer/stacks/sbtc";
import {
	readCanonicalStreamsEvents,
	readCanonicalStreamsEventsByTxId,
} from "../streams-events.ts";
import {
	BNS_DECODER_NAME,
	BNS_V2_MAINNET_CONTRACT,
	decodeBnsPage,
} from "./decoders/bns.ts";
import {
	POX5_CONTRACT,
	POX5_DECODER_NAME,
	POX5_STREAM_TYPES,
	decodePox5Page,
} from "./decoders/pox-5.ts";
import {
	SBTC_DECODER_NAME,
	SBTC_STREAM_TYPES,
	type SbtcPageCarry,
	decodeSbtcPage,
	registryContractId,
	tokenContractId,
} from "./decoders/sbtc.ts";
import {
	type ProtocolDecoderName,
	runProtocolDecodeCycle,
} from "./protocol-decoders.ts";
import {
	DecoderCheckpointRewoundError,
	readDecoderCheckpoint,
	writeDecoderCheckpoint,
} from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const OWNER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const DEPOSITOR = "SP34HBPH4EHPVW0NSXBCV5Z27FAGTC62RV5Y9Y9MR";

type SeedEvent = {
	txId: string;
	type: "smart_contract_event" | "ft_mint_event";
	data: Record<string, unknown>;
};

function print(contract: string, tuple: ReturnType<typeof tupleCV>): SeedEvent {
	return {
		txId: "",
		type: "smart_contract_event",
		data: {
			contract_identifier: contract,
			topic: "print",
			value: { hex: serializeCV(tuple), repr: "(tuple ...)" },
		},
	};
}

function sbtcDeposit(tx: string, amount: bigint): SeedEvent[] {
	return [
		{
			txId: tx,
			type: "ft_mint_event",
			data: {
				asset_identifier: SBTC_ASSET_IDENTIFIER_MAINNET,
				recipient: DEPOSITOR,
				amount: amount.toString(),
			},
		},
		{
			...print(
				registryContractId(),
				tupleCV({
					topic: stringAsciiCV("completed-deposit"),
					"bitcoin-txid": bufferCV(new Uint8Array([0xaa, 0xbb])),
					"output-index": uintCV(1n),
					amount: uintCV(amount),
					"burn-hash": bufferCV(new Uint8Array([0xde, 0xad])),
					"burn-height": uintCV(902481n),
					"sweep-txid": bufferCV(new Uint8Array([0x11, 0x22])),
				}),
			),
			txId: tx,
		},
	];
}

function sbtcRegistryNoise(tx: string): SeedEvent {
	return {
		...print(
			registryContractId(),
			tupleCV({
				topic: stringAsciiCV("withdrawal-reject"),
				"request-id": uintCV(4n),
				"signer-bitmap": uintCV(3n),
			}),
		),
		txId: tx,
	};
}

function pox5Stake(tx: string): SeedEvent {
	return {
		...print(
			POX5_CONTRACT,
			tupleCV({
				topic: stringAsciiCV("stake"),
				signer: standardPrincipalCV(OWNER),
				staker: standardPrincipalCV(STAKER),
				"amount-ustx": uintCV(5_000_000_000n),
				"num-cycles": uintCV(12n),
				"first-reward-cycle": uintCV(140n),
				"unlock-burn-height": uintCV(987_530n),
				"unlock-cycle": uintCV(152n),
			}),
		),
		txId: tx,
	};
}

function bnsNewName(tx: string, name: string, id: bigint): SeedEvent {
	const buff = (value: string, len: number) => {
		const out = new Uint8Array(len);
		out.set(new TextEncoder().encode(value));
		return bufferCV(out);
	};
	return {
		...print(
			BNS_V2_MAINNET_CONTRACT,
			tupleCV({
				topic: stringAsciiCV("new-name"),
				namespace: buff("btc", 20),
				name: buff(name, 48),
				id: uintCV(id),
				owner: standardPrincipalCV(OWNER),
				properties: tupleCV({
					"registered-at": someCV(uintCV(7_869_999n)),
					"imported-at": noneCV(),
					"renewal-height": someCV(uintCV(7_919_999n)),
					"stx-burn": uintCV(2_500_000n),
					"preordered-by": someCV(standardPrincipalCV(OWNER)),
					"hashed-salted-fqn-preorder": bufferCV(new Uint8Array(32).fill(0x11)),
				}),
			}),
		),
		txId: tx,
	};
}

function unrelatedPrint(tx: string): SeedEvent {
	return {
		...print("SP1.unrelated", tupleCV({ topic: stringAsciiCV("noise") })),
		txId: tx,
	};
}

const SENTINEL = (height: number) =>
	encodeStreamsCursor(blockEndCursor(height));

describe.skipIf(!HAS_DB)("protocol decoders in-process loop", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await clearDecoded();
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	async function clearDecoded() {
		if (!db) throw new Error("missing db");
		await sql`DELETE FROM sbtc_events`.execute(db);
		await sql`DELETE FROM pox5_events`.execute(db);
		await sql`DELETE FROM bns_name_events`.execute(db);
		await sql`DELETE FROM bns_names`.execute(db);
		await sql`DELETE FROM decoder_checkpoints`.execute(db);
		await sql`DELETE FROM stage_failures`.execute(db);
	}

	async function seedBlock(height: number, events: SeedEvent[]) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height,
				hash: `0x${height.toString(16).padStart(4, "0")}`,
				parent_hash: `0x${(height - 1).toString(16).padStart(4, "0")}`,
				burn_block_height: 960_500 + height,
				timestamp: 1_800_000_000 + height,
				canonical: true,
			})
			.execute();
		const txIds = [...new Set(events.map((event) => event.txId))];
		if (txIds.length > 0) {
			await db
				.insertInto("transactions")
				.values(
					txIds.map((tx_id, tx_index) => ({
						tx_id,
						block_height: height,
						tx_index,
						type: "contract_call",
						sender: "SP1",
						status: "success",
						contract_id: "SP1.contract",
						raw_tx: "0x00",
					})),
				)
				.execute();
			await db
				.insertInto("events")
				.values(
					events.map((event, event_index) => ({
						tx_id: event.txId,
						block_height: height,
						event_index,
						type: event.type,
						data: event.data,
					})),
				)
				.execute();
		}
	}

	async function snapshot() {
		if (!db) throw new Error("missing db");
		const [sbtc, pox5, names, projection, checkpoints] = await Promise.all([
			db
				.selectFrom("sbtc_events")
				.select(["cursor", "topic", "recipient", "amount"])
				.orderBy("cursor")
				.execute(),
			db
				.selectFrom("pox5_events")
				.select(["cursor", "topic", "staker", "amount_ustx"])
				.orderBy("cursor")
				.execute(),
			db
				.selectFrom("bns_name_events")
				.select(["cursor", "topic", "fqn", "owner"])
				.orderBy("cursor")
				.execute(),
			db
				.selectFrom("bns_names")
				.select(["fqn", "owner"])
				.orderBy("fqn")
				.execute(),
			db
				.selectFrom("decoder_checkpoints")
				.select(["decoder_name", "last_cursor"])
				.orderBy("decoder_name")
				.execute(),
		]);
		return { sbtc, pox5, names, projection, checkpoints };
	}

	async function seedMixedChain() {
		await seedBlock(1, [
			unrelatedPrint("tx-noise-1"),
			pox5Stake("tx-pox"),
			bnsNewName("tx-bns-1", "alice", 1n),
			sbtcRegistryNoise("tx-reject"),
		]);
		await seedBlock(2, [
			...sbtcDeposit("tx-deposit", 14_025n),
			bnsNewName("tx-bns-2", "bob", 2n),
		]);
		await seedBlock(3, [unrelatedPrint("tx-noise-3")]);
	}

	async function cycle(
		enabled: ProtocolDecoderName[],
		limit?: number,
	): Promise<Awaited<ReturnType<typeof runProtocolDecodeCycle>>> {
		const result = await runProtocolDecodeCycle({
			db: db ?? undefined,
			enabled,
			limit,
		});
		expect(result.failures).toEqual([]);
		return result;
	}

	const ALL: ProtocolDecoderName[] = [
		SBTC_DECODER_NAME,
		POX5_DECODER_NAME,
		BNS_DECODER_NAME,
	];

	async function seedBnsCheckpointAtGenesis() {
		await writeDecoderCheckpoint({
			db: db ?? undefined,
			decoderName: BNS_DECODER_NAME,
			cursor: "0:0",
		});
	}

	test("one cycle routes each contract's prints to its own table and reaches the end-of-block sentinel", async () => {
		await seedMixedChain();
		await seedBnsCheckpointAtGenesis();

		const result = await cycle(ALL);

		expect(result.progressed).toBe(true);
		expect(result.decodedByDecoder).toEqual({
			[SBTC_DECODER_NAME]: 2,
			[POX5_DECODER_NAME]: 1,
			[BNS_DECODER_NAME]: 2,
		});
		const snap = await snapshot();
		expect(snap.sbtc.map((row) => row.topic)).toEqual([
			"withdrawal-reject",
			"completed-deposit",
		]);
		expect(snap.pox5.map((row) => row.staker)).toEqual([STAKER]);
		expect(snap.names.map((row) => row.fqn)).toEqual(["alice.btc", "bob.btc"]);
		expect(snap.checkpoints).toEqual([
			{ decoder_name: BNS_DECODER_NAME, last_cursor: SENTINEL(3) },
			{ decoder_name: POX5_DECODER_NAME, last_cursor: SENTINEL(3) },
			{ decoder_name: SBTC_DECODER_NAME, last_cursor: SENTINEL(3) },
		]);
	});

	test("a second cycle at the same tip reads nothing and reports no progress", async () => {
		await seedMixedChain();
		await cycle(ALL);

		const result = await cycle(ALL);

		expect(result.progressed).toBe(false);
		expect(result.pagesCommitted).toBe(0);
	});

	test("each decoder resumes from its own checkpoint", async () => {
		await seedMixedChain();
		await writeDecoderCheckpoint({
			db: db ?? undefined,
			decoderName: POX5_DECODER_NAME,
			cursor: SENTINEL(1),
		});

		const result = await cycle([POX5_DECODER_NAME, SBTC_DECODER_NAME]);

		expect(result.decodedByDecoder[POX5_DECODER_NAME]).toBe(0);
		expect(result.decodedByDecoder[SBTC_DECODER_NAME]).toBe(2);
		const snap = await snapshot();
		expect(snap.pox5).toEqual([]);
		expect(
			snap.checkpoints.find((c) => c.decoder_name === POX5_DECODER_NAME)
				?.last_cursor,
		).toBe(SENTINEL(3));
	});

	test("an sBTC deposit whose mint ends one page and whose print starts the next still gets its recipient", async () => {
		await seedBlock(1, [
			sbtcRegistryNoise("tx-a"),
			...sbtcDeposit("tx-d", 77n),
		]);

		await cycle([SBTC_DECODER_NAME], 2);

		const snap = await snapshot();
		const deposit = snap.sbtc.find((row) => row.topic === "completed-deposit");
		expect(deposit?.recipient).toBe(DEPOSITOR);
		expect(snap.checkpoints[0]?.last_cursor).toBe(SENTINEL(1));
	});

	test("an sBTC deposit whose mint precedes the resume cursor reads the mint by tx id", async () => {
		await seedBlock(1, sbtcDeposit("tx-d", 5_000n));
		await writeDecoderCheckpoint({
			db: db ?? undefined,
			decoderName: SBTC_DECODER_NAME,
			cursor: "1:0",
		});

		await cycle([SBTC_DECODER_NAME]);

		const snap = await snapshot();
		expect(snap.sbtc).toHaveLength(1);
		expect(snap.sbtc[0]?.recipient).toBe(DEPOSITOR);
	});

	test("a never-checkpointed BNS decoder seeds to the tip and decodes nothing historical", async () => {
		await seedMixedChain();

		const result = await cycle([BNS_DECODER_NAME]);

		expect(result.decodedByDecoder[BNS_DECODER_NAME]).toBe(0);
		const snap = await snapshot();
		expect(snap.names).toEqual([]);
		expect(
			await readDecoderCheckpoint({
				db: db ?? undefined,
				decoderName: BNS_DECODER_NAME,
			}),
		).toBe(SENTINEL(3));
	});

	test("a page committed against a moved checkpoint is rejected as a rewind", async () => {
		await seedMixedChain();
		const read = async (contractId: string): Promise<StreamsEvent[]> =>
			(
				await readCanonicalStreamsEvents({
					db: db ?? undefined,
					toHeight: 3,
					types: ["print"],
					contractId,
					limit: 100,
				})
			).events as StreamsEvent[];
		await writeDecoderCheckpoint({
			db: db ?? undefined,
			decoderName: POX5_DECODER_NAME,
			cursor: "5:0",
		});
		await writeDecoderCheckpoint({
			db: db ?? undefined,
			decoderName: BNS_DECODER_NAME,
			cursor: "5:0",
		});

		await expect(
			decodePox5Page({
				db: db ?? undefined,
				events: await read(POX5_CONTRACT),
				checkpointCursor: SENTINEL(9),
				startedFrom: "1:0",
			}),
		).rejects.toBeInstanceOf(DecoderCheckpointRewoundError);
		await expect(
			decodeBnsPage({
				db: db ?? undefined,
				events: await read(BNS_V2_MAINNET_CONTRACT),
				checkpointCursor: SENTINEL(9),
				startedFrom: "1:0",
			}),
		).rejects.toBeInstanceOf(DecoderCheckpointRewoundError);
	});

	describe("parity with the paged Streams consumer", () => {
		async function referenceRun(batchSize: number) {
			if (!db) throw new Error("missing db");
			const tip = (
				await db
					.selectFrom("blocks")
					.select((eb) => eb.fn.max("height").as("height"))
					.executeTakeFirstOrThrow()
			).height as number;
			const read = async (
				types: readonly StreamsEvent["event_type"][],
				contractId: string | string[],
				after: string | null,
			) => {
				const page = await readCanonicalStreamsEvents({
					db,
					after: after ? decodeCursor(after) : undefined,
					toHeight: tip,
					types,
					contractId,
					limit: batchSize,
				});
				return {
					events: page.events as StreamsEvent[],
					next: page.next_cursor,
				};
			};
			const drain = async (
				decoderName: string,
				types: readonly StreamsEvent["event_type"][],
				contractId: string | string[],
				commit: (page: {
					events: StreamsEvent[];
					cursor: string;
					startedFrom: string | null;
				}) => Promise<void>,
			) => {
				let cursor = await readDecoderCheckpoint({ db, decoderName });
				for (;;) {
					const { events, next } = await read(types, contractId, cursor);
					const short = events.length < batchSize;
					const checkpoint = short
						? SENTINEL(tip)
						: (next ?? events.at(-1)?.cursor ?? null);
					if (checkpoint === null) return;
					await commit({ events, cursor: checkpoint, startedFrom: cursor });
					cursor = checkpoint;
					if (short) return;
				}
			};

			let carry: SbtcPageCarry = { lastMint: null };
			await drain(
				SBTC_DECODER_NAME,
				SBTC_STREAM_TYPES,
				[registryContractId(), tokenContractId()],
				async (page) => {
					const result = await decodeSbtcPage({
						db: db ?? undefined,
						events: page.events,
						checkpointCursor: page.cursor,
						startedFrom: page.startedFrom,
						carry,
						eventsByTxId: async (txId) =>
							(
								await readCanonicalStreamsEventsByTxId({
									txId,
									db: db ?? undefined,
								})
							).events as StreamsEvent[],
					});
					carry = result.carry;
				},
			);
			await drain(
				POX5_DECODER_NAME,
				POX5_STREAM_TYPES,
				POX5_CONTRACT,
				async (page) => {
					await decodePox5Page({
						db: db ?? undefined,
						events: page.events,
						checkpointCursor: page.cursor,
						startedFrom: page.startedFrom,
					});
				},
			);
			await drain(
				BNS_DECODER_NAME,
				["print"],
				BNS_V2_MAINNET_CONTRACT,
				async (page) => {
					await decodeBnsPage({
						db: db ?? undefined,
						events: page.events,
						checkpointCursor: page.cursor,
						startedFrom: page.startedFrom,
					});
				},
			);
		}

		function decodeCursor(cursor: string) {
			const [height, index] = cursor.split(":").map(Number);
			return { block_height: height as number, event_index: index as number };
		}

		for (const limit of [1, 2, 3, 10_000]) {
			test(`in-process cycle writes the same rows and checkpoints as the paged consumer at page size ${limit}`, async () => {
				await seedMixedChain();
				await seedBlock(4, [
					...sbtcDeposit("tx-d4", 900n),
					pox5Stake("tx-pox4"),
				]);
				await seedBnsCheckpointAtGenesis();

				await referenceRun(limit);
				const reference = await snapshot();
				await clearDecoded();
				await seedBnsCheckpointAtGenesis();
				await cycle(ALL, limit);
				const inProcess = await snapshot();

				expect(reference.sbtc.length).toBeGreaterThan(0);
				expect(reference.pox5.length).toBeGreaterThan(0);
				expect(reference.names.length).toBeGreaterThan(0);
				expect(inProcess).toEqual(reference);
			});
		}
	});
});
