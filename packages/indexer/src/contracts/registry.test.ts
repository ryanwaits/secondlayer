import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { StacksNodeClient } from "@secondlayer/shared/node/client";
import { discoverDeploys, processPendingAbis } from "./registry.ts";

const HAS_DB = !!process.env.DATABASE_URL;
// BELOW reorg.test.ts's 990050: its handleReorg assertions take MAX(height)
// over canonical blocks >= 990050, so leftover canonical seeds above that
// height would corrupt them.
const H = 989900;

// CANON-01 recovery leg: after handleReorg flips a contract non-canonical,
// discovery must re-select it once its deploy tx exists on the (new) fork and
// re-canonicalize via recordContractDeploy's upsert — while leaving contracts
// that are already canonical alone.
describe.skipIf(!HAS_DB)("discoverDeploys reorg re-canonicalization", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "in", ["SP9.recanon", "SP9.already-canon"])
			.execute();
		await db
			.deleteFrom("transactions")
			.where("tx_id", "in", ["0xrecanon-tx", "0xalready-tx"])
			.execute();
		await db
			.deleteFrom("blocks")
			.where("height", "in", [H, H + 1])
			.execute();
		// transactions.block_height FKs blocks(height).
		await db
			.insertInto("blocks")
			.values(
				[H, H + 1].map((height) => ({
					height,
					hash: `0xcanonblock${height}`,
					parent_hash: "0xparent",
					burn_block_height: 1,
					burn_block_hash: null,
					timestamp: 1_700_000_000,
					canonical: true,
				})),
			)
			.execute();
	});

	afterAll(async () => {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "in", ["SP9.recanon", "SP9.already-canon"])
			.execute();
		await db
			.deleteFrom("transactions")
			.where("tx_id", "in", ["0xrecanon-tx", "0xalready-tx"])
			.execute();
		await db
			.deleteFrom("blocks")
			.where("height", "in", [H, H + 1])
			.execute();
	});

	test("re-selects a non-canonical id whose deploy tx exists and re-canonicalizes it", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xrecanon-tx",
				block_height: H,
				tx_index: 0,
				type: "smart_contract",
				sender: "SP9",
				status: "success",
				contract_id: "SP9.recanon",
				raw_tx: "0x00",
			})
			.execute();
		// Old-fork registry row, flipped by handleReorg.
		await db
			.insertInto("contracts")
			.values({
				contract_id: "SP9.recanon",
				deployer: "SP9",
				block_height: H - 3,
				canonical: false,
			})
			.execute();

		await discoverDeploys(db);

		const row = await db
			.selectFrom("contracts")
			.select(["canonical", "block_height"])
			.where("contract_id", "=", "SP9.recanon")
			.executeTakeFirstOrThrow();
		expect(row.canonical).toBe(true);
		expect(Number(row.block_height)).toBe(H);
	});

	test("leaves already-canonical contracts alone", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xalready-tx",
				block_height: H + 1,
				tx_index: 0,
				type: "smart_contract",
				sender: "SP9",
				status: "success",
				contract_id: "SP9.already-canon",
				raw_tx: "0x00",
			})
			.execute();
		// Marker: deployer differs from the tx sender — if discovery wrongly
		// re-records a canonical id, the upsert would overwrite it with "SP9".
		await db
			.insertInto("contracts")
			.values({
				contract_id: "SP9.already-canon",
				deployer: "SP-marker",
				block_height: H + 1,
				canonical: true,
			})
			.execute();

		await discoverDeploys(db);

		const row = await db
			.selectFrom("contracts")
			.select("deployer")
			.where("contract_id", "=", "SP9.already-canon")
			.executeTakeFirstOrThrow();
		expect(row.deployer).toBe("SP-marker");
	});
});

// processPendingAbis: real caller of @secondlayer/stacks's getContractAbi /
// getContractSource against a live node. Mock server stands in for the node.
// parseContractId now requires a c32-decodable principal — SP9 is not one.
const ABI_MOCK_PORT = 19442;
const ABI_ADDR = "SP000000000000000000002Q6VF78";
const PENDING_OK = `${ABI_ADDR}.pending-ok`;
const PENDING_MISSING = `${ABI_ADDR}.pending-missing`;
let abiMockServer: ReturnType<typeof Bun.serve> | undefined;

describe.skipIf(!HAS_DB)("processPendingAbis", () => {
	const db = HAS_DB ? getDb() : null;
	const node = new StacksNodeClient(`http://localhost:${ABI_MOCK_PORT}`);

	beforeAll(() => {
		abiMockServer = Bun.serve({
			port: ABI_MOCK_PORT,
			routes: {
				[`/v2/contracts/interface/${ABI_ADDR}/pending-ok`]: () =>
					Response.json({
						functions: [],
						maps: [],
						variables: [],
						fungible_tokens: [],
						non_fungible_tokens: [],
					}),
				[`/v2/contracts/source/${ABI_ADDR}/pending-ok`]: () =>
					Response.json({
						source: `(impl-trait '${ABI_ADDR}.sip-010-trait.sip-010-trait)`,
						publish_height: 1,
					}),
			},
			fetch() {
				return new Response("Not Found", { status: 404 });
			},
		});
	});

	afterAll(() => {
		abiMockServer?.stop();
	});

	beforeEach(async () => {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "in", [PENDING_OK, PENDING_MISSING])
			.execute();
	});

	afterAll(async () => {
		if (!db) return;
		await db
			.deleteFrom("contracts")
			.where("contract_id", "in", [PENDING_OK, PENDING_MISSING])
			.execute();
	});

	test("fetches the ABI, classifies it, and marks the row fetched", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: PENDING_OK,
				deployer: ABI_ADDR,
				block_height: 999_999_001,
				canonical: true,
				abi_status: "pending",
			})
			.execute();

		await processPendingAbis(db, node, { limit: 500 });

		const row = await db
			.selectFrom("contracts")
			.select(["abi_status", "declared_traits"])
			.where("contract_id", "=", PENDING_OK)
			.executeTakeFirstOrThrow();
		expect(row.abi_status).toBe("fetched");
		// parseDeclaredStandards normalizes to SIP labels, not the raw trait name.
		expect(row.declared_traits).toContain("sip-010");
	});

	test("marks a contract failed when the ABI fetch 404s", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: PENDING_MISSING,
				deployer: ABI_ADDR,
				block_height: 999_999_002,
				canonical: true,
				abi_status: "pending",
			})
			.execute();

		await processPendingAbis(db, node, { limit: 500 });

		const row = await db
			.selectFrom("contracts")
			.select(["abi_status"])
			.where("contract_id", "=", PENDING_MISSING)
			.executeTakeFirstOrThrow();
		expect(row.abi_status).toBe("failed");
	});
	async function seedFailed(
		attempts: number,
		nextAttemptAt: Date | null,
	): Promise<void> {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: PENDING_OK,
				deployer: ABI_ADDR,
				block_height: 999_999_003,
				canonical: true,
				abi_status: "failed",
				abi_attempts: attempts,
				abi_next_attempt_at: nextAttemptAt,
			})
			.execute();
	}

	async function abiRow() {
		if (!db) throw new Error("missing db");
		return db
			.selectFrom("contracts")
			.select(["abi_status", "abi_attempts", "abi_next_attempt_at"])
			.where("contract_id", "=", PENDING_OK)
			.executeTakeFirstOrThrow();
	}

	test("a failed contract that is due is fetched again and becomes fetched", async () => {
		if (!db) throw new Error("missing db");
		await seedFailed(1, new Date(Date.now() - 1_000));
		await processPendingAbis(db, node, { limit: 500 });
		expect((await abiRow()).abi_status).toBe("fetched");
	});

	test("a failed contract is left alone until its backoff elapses", async () => {
		if (!db) throw new Error("missing db");
		await seedFailed(1, new Date(Date.now() + 3_600_000));
		await processPendingAbis(db, node, { limit: 500 });
		expect((await abiRow()).abi_status).toBe("failed");
	});

	test("a failed contract out of attempts is never polled again", async () => {
		if (!db) throw new Error("missing db");
		await seedFailed(5, null);
		await processPendingAbis(db, node, { limit: 500 });
		expect((await abiRow()).abi_status).toBe("failed");
	});

	test("a failed fetch counts the attempt and schedules the retry", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: PENDING_MISSING,
				deployer: ABI_ADDR,
				block_height: 999_999_002,
				canonical: true,
				abi_status: "pending",
			})
			.execute();
		await processPendingAbis(db, node, { limit: 500 });
		const row = await db
			.selectFrom("contracts")
			.select(["abi_attempts", "abi_next_attempt_at"])
			.where("contract_id", "=", PENDING_MISSING)
			.executeTakeFirstOrThrow();
		expect(Number(row.abi_attempts)).toBe(1);
		expect(row.abi_next_attempt_at).not.toBeNull();
	});

	test("the final failed attempt stops the retries", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("contracts")
			.values({
				contract_id: PENDING_MISSING,
				deployer: ABI_ADDR,
				block_height: 999_999_002,
				canonical: true,
				abi_status: "failed",
				abi_attempts: 4,
				abi_next_attempt_at: new Date(Date.now() - 1_000),
			})
			.execute();
		await processPendingAbis(db, node, { limit: 500 });
		const row = await db
			.selectFrom("contracts")
			.select(["abi_attempts", "abi_next_attempt_at"])
			.where("contract_id", "=", PENDING_MISSING)
			.executeTakeFirstOrThrow();
		expect(Number(row.abi_attempts)).toBe(5);
		expect(row.abi_next_attempt_at).toBeNull();
	});
});
