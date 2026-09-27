import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	bufferCV,
	serializeCV,
	someCV,
	standardPrincipalCV,
	stringAsciiCV,
	tupleCV,
	uintCV,
} from "@secondlayer/stacks/clarity";
import { persistBlock } from "../persist.ts";
import { BNS_V2_MAINNET_CONTRACT } from "./decoders/bns.ts";
import { rederiveBnsEvents } from "./rederive-bns-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// Below reorg.test.ts's 990050: handleReorg takes MAX(canonical height)
// >= its fork point, so leftover seeds above it would corrupt that test.
const H = 989501;
const NETWORK = "rederive-bns-test";
const OWNER = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";

function bytesFromString(s: string, len: number): Uint8Array {
	const out = new Uint8Array(len);
	const utf8 = new TextEncoder().encode(s);
	out.set(utf8.subarray(0, Math.min(utf8.length, len)));
	return out;
}

describe.skipIf(!HAS_DB)("rederiveBnsEvents", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});
	afterAll(async () => {
		if (!db) return;
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "=", H)
			.execute();
		await db.deleteFrom("events").where("block_height", "=", H).execute();
		await db.deleteFrom("transactions").where("block_height", "=", H).execute();
		await db.deleteFrom("blocks").where("height", "=", H).execute();
		await db
			.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	});

	async function seedBnsNameEventBlock(): Promise<void> {
		if (!db) throw new Error("missing db");
		const tuple = tupleCV({
			topic: stringAsciiCV("new-name"),
			namespace: bufferCV(bytesFromString("btc", 20)),
			name: bufferCV(bytesFromString("alice", 48)),
			id: uintCV(12_345n),
			owner: standardPrincipalCV(OWNER),
			properties: tupleCV({
				"registered-at": someCV(uintCV(7_869_999n)),
			}),
		});
		await persistBlock(db, {
			block: {
				height: H,
				hash: "0xblockH",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [
				{
					tx_id: "0xbnstxa",
					block_height: H,
					tx_index: 0,
					type: "contract_call",
					sender: "SP1",
					status: "success",
					raw_tx: "0x00",
				},
			],
			evts: [
				{
					tx_id: "0xbnstxa",
					block_height: H,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: BNS_V2_MAINNET_CONTRACT,
						topic: "print",
						value: { hex: serializeCV(tuple) },
					},
				},
			],
			blockHeight: H,
			network: NETWORK,
		});
	}

	test("a window re-derive after a source repair produces the decoded name event for the restored event", async () => {
		if (!db) throw new Error("missing db");
		await seedBnsNameEventBlock();

		const result = await rederiveBnsEvents({
			fromHeight: H,
			toHeight: H,
			apply: true,
		});
		expect(result.decoded.names).toBe(1);

		const rows = await db
			.selectFrom("bns_name_events")
			.select(["fqn", "topic", "owner"])
			.where("block_height", "=", H)
			.execute();
		expect(rows).toEqual([
			{ fqn: "alice.btc", topic: "new-name", owner: OWNER },
		]);
	});

	test("dry-run decodes without writing", async () => {
		if (!db) throw new Error("missing db");
		await seedBnsNameEventBlock();

		const result = await rederiveBnsEvents({
			fromHeight: H,
			toHeight: H,
			apply: false,
		});
		expect(result.decoded.names).toBe(1);

		const rows = await db
			.selectFrom("bns_name_events")
			.select("fqn")
			.where("block_height", "=", H)
			.execute();
		expect(rows).toHaveLength(0);
	});
});
