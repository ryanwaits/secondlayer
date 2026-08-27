import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createApiApp } from "../../create-app.ts";
import { createExtendedApp } from "../app.ts";
import type { ExtendedBlock, ExtendedBlockListItem } from "../blocks.ts";
import type { ExtendedBnsName } from "../bns.ts";
import type { ExtendedTxEvent } from "../events.ts";
import type { ExtendedTx } from "../transactions.ts";
import type { ExtendedNftTransfer } from "../transfers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBSET_PATH = join(HERE, "v9.0.2-subset.yaml");

const PINNED_PATHS = [
	"/extended/v1/status",
	"/extended/v1/block",
	"/extended/v1/block/{hash}",
	"/extended/v1/tx",
	"/extended/v1/tx/{tx_id}",
	"/extended/v1/tx/{tx_id}/events",
	"/extended/v1/address/{principal}/transactions",
	"/extended/v1/address/{principal}/stx",
	"/extended/v1/address/{principal}/ft",
	"/extended/v1/address/{principal}/nft",
	"/extended/v1/names",
	"/extended/v1/names/{name}",
	"/extended/v1/tokens/nft/transfers",
] as const;

const OffsetPageKeys = {
	limit: z.number().int(),
	offset: z.number().int(),
	total: z.number().int(),
} as const;

const statusSchema = z
	.object({
		server_version: z.string(),
		status: z.literal("ready"),
		chain_tip: z
			.object({
				block_height: z.number().int(),
				block_hash: z.string(),
				index_block_hash: z.string().nullable(),
				burn_block_height: z.number().int(),
			})
			.strict()
			.optional(),
	})
	.strict();

const blockListItemSchema = z
	.object({
		canonical: z.boolean(),
		height: z.number().int(),
		hash: z.string(),
		index_block_hash: z.string().nullable(),
		parent_block_hash: z.string(),
		parent_index_block_hash: z.string().nullable(),
		burn_block_hash: z.string().nullable(),
		burn_block_height: z.number().int(),
		burn_block_time: z.number().int(),
		burn_block_time_iso: z.string(),
	})
	.strict();

const blockSchema = blockListItemSchema
	.extend({
		txs: z.array(z.string()),
		tx_count: z.number().int(),
	})
	.strict();

const blockListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(blockListItemSchema),
	})
	.strict();

const txSchema = z
	.object({
		tx_id: z.string(),
		tx_index: z.number().int(),
		tx_status: z.string(),
		tx_type: z.string(),
		sender_address: z.string(),
		block_height: z.number().int(),
		block_hash: z.string().nullable().optional(),
		burn_block_time: z.number().int().nullable().optional(),
		canonical: z.boolean().optional(),
		fee_rate: z.string().optional(),
		nonce: z.number().int().optional(),
		sponsored: z.boolean().optional(),
		anchor_mode: z.string().nullable().optional(),
		post_condition_mode: z.string().nullable().optional(),
		token_transfer: z
			.object({
				recipient: z.string(),
				amount: z.string(),
				memo: z.string(),
			})
			.strict()
			.optional(),
		contract_call: z
			.object({
				contract_id: z.string(),
				function_name: z.string(),
			})
			.strict()
			.optional(),
		smart_contract: z
			.object({
				contract_id: z.string().nullable(),
				clarity_version: z.number().int().nullable(),
			})
			.strict()
			.optional(),
		coinbase: z
			.object({
				alt_recipient: z.string().nullable(),
			})
			.strict()
			.optional(),
		tenure_change: z
			.object({
				cause: z.number().int(),
			})
			.strict()
			.optional(),
	})
	.strict();

const txListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(txSchema),
	})
	.strict();

const txEventSchema = z
	.object({
		event_index: z.number().int(),
		event_type: z.enum([
			"stx_asset",
			"fungible_token_asset",
			"non_fungible_token_asset",
			"smart_contract_log",
		]),
		tx_id: z.string(),
		asset: z
			.object({
				asset_event_type: z.enum(["transfer", "mint", "burn"]).optional(),
				sender: z.string().nullable().optional(),
				recipient: z.string().nullable().optional(),
				amount: z.string().nullable().optional(),
				asset_id: z.string().nullable().optional(),
				value: z.string().nullable().optional(),
				memo: z.string().nullable().optional(),
			})
			.strict()
			.optional(),
		contract_log: z
			.object({
				contract_id: z.string().nullable(),
				topic: z.unknown().optional(),
				value: z.unknown().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const txEventArraySchema = z.array(txEventSchema);

const stxSchema = z
	.object({
		balance: z.string(),
		total_sent: z.string(),
		total_received: z.string(),
		locked: z.string().optional(),
		lock_tx_id: z.string().optional(),
		unlock_height: z.union([z.number(), z.string()]).optional(),
	})
	.strict();

const ftHoldingsListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(
			z
				.object({
					asset_identifier: z.string(),
					balance: z.string(),
				})
				.strict(),
		),
	})
	.strict();

const nftHoldingsListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(
			z
				.object({
					asset_identifier: z.string(),
					value: z.string(),
				})
				.strict(),
		),
	})
	.strict();

const bnsNameSchema = z
	.object({
		name: z.string(),
		namespace: z.string(),
		fqn: z.string(),
		owner: z.string().nullable(),
		bns_id: z.string(),
		topic: z.string(),
		tx_id: z.string(),
		block_height: z.number().int(),
		registered_at: z.number().int().nullable(),
		renewal_height: z.number().int().nullable(),
	})
	.strict();

const bnsNameListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(bnsNameSchema),
	})
	.strict();

const bnsNameOrEmptySchema = z.union([z.object({}).strict(), bnsNameSchema]);

const nftTransferListSchema = z
	.object({
		...OffsetPageKeys,
		results: z.array(
			z
				.object({
					sender: z.string().nullable(),
					recipient: z.string().nullable(),
					asset_identifier: z.string(),
					value: z.string().nullable(),
					tx_id: z.string(),
					block_height: z.number().int(),
					event_index: z.number().int(),
					asset_event_type: z.literal("transfer"),
				})
				.strict(),
		),
	})
	.strict();

const BLOCK_LIST_ITEM: ExtendedBlockListItem = {
	canonical: true,
	height: 100,
	hash: "0xblock100",
	index_block_hash: "0xidx100",
	parent_block_hash: "0xblock99",
	parent_index_block_hash: "0xidx99",
	burn_block_hash: "0xburn",
	burn_block_height: 850_000,
	burn_block_time: 1_700_000_000,
	burn_block_time_iso: "2023-11-14T22:13:20.000Z",
};

const BLOCK: ExtendedBlock = {
	...BLOCK_LIST_ITEM,
	txs: ["0xtx0"],
	tx_count: 1,
};

const TX: ExtendedTx = {
	tx_id: "0xabc",
	tx_index: 0,
	tx_status: "success",
	tx_type: "token_transfer",
	sender_address: "SP1SENDER",
	block_height: 100,
	block_hash: "0xblock100",
	burn_block_time: 1_700_000_000,
	canonical: true,
	fee_rate: "180",
	nonce: 7,
	sponsored: false,
	anchor_mode: "any",
	post_condition_mode: "deny",
	token_transfer: {
		recipient: "SP1RECV",
		amount: "1000",
		memo: "",
	},
};

const TX_EVENT: ExtendedTxEvent = {
	event_index: 0,
	event_type: "stx_asset",
	tx_id: "0xabc",
	asset: {
		asset_event_type: "transfer",
		sender: "SP1SENDER",
		recipient: "SP1RECV",
		amount: "1000",
	},
};

const BNS: ExtendedBnsName = {
	name: "alice",
	namespace: "btc",
	fqn: "alice.btc",
	owner: "SP1OWNER",
	bns_id: "u1",
	topic: "new-name",
	tx_id: "0xabc",
	block_height: 100,
	registered_at: 1_700_000_000,
	renewal_height: 200,
};

const NFT_TRANSFER: ExtendedNftTransfer = {
	sender: "SP1SENDER",
	recipient: "SP1RECV",
	asset_identifier: "SP1.nft::NFT",
	value: "7",
	tx_id: "0xabc",
	block_height: 100,
	event_index: 0,
	asset_event_type: "transfer",
};

function injectedApp(bnsEnabled = true) {
	return createExtendedApp({
		getTip: async () => ({
			block_height: 100,
			finalized_height: 99,
			lag_seconds: 1,
		}),
		readCanonicalBlock: async () => ({
			block_height: 100,
			block_hash: "0xblock100",
			index_block_hash: "0xidx100",
			burn_block_height: 850_000,
		}),
		listBlocks: async () => ({ results: [BLOCK_LIST_ITEM], total: 1 }),
		getBlock: async () => BLOCK,
		listTransactions: async () => ({ results: [TX], total: 1 }),
		getTransaction: async () => TX,
		listTxEvents: async () => [TX_EVENT],
		getStx: async () => ({
			balance: "60",
			total_sent: "40",
			total_received: "100",
			locked: "10",
			lock_tx_id: "0xlock",
			unlock_height: 200,
		}),
		listFt: async () => ({
			results: [{ asset_identifier: "SP1.token::TOKEN", balance: "60" }],
			total: 1,
		}),
		listNft: async () => ({
			results: [{ asset_identifier: "SP1.nft::NFT", value: "7" }],
			total: 1,
		}),
		listBnsNames: async () => ({ results: [BNS], total: 1 }),
		getBnsName: async () => BNS,
		listNftTransfers: async () => ({ results: [NFT_TRANSFER], total: 1 }),
		bnsEnabled,
	});
}

describe("extended openapi subset pin", () => {
	test("subset YAML parses and pins exactly 13 paths", async () => {
		const raw = await Bun.file(SUBSET_PATH).text();
		expect(raw).toContain("upstream tag: v9.0.2");
		expect(raw).toContain(
			"https://raw.githubusercontent.com/hirosystems/stacks-blockchain-api/v9.0.2/openapi.yaml",
		);
		const spec = Bun.YAML.parse(raw) as { paths: Record<string, unknown> };
		const paths = Object.keys(spec.paths).sort();
		expect(paths).toEqual([...PINNED_PATHS].sort());
		expect(paths).toHaveLength(13);
	});

	test("/v1/openapi.json has no /extended path keys", async () => {
		const app = createApiApp("oss");
		const res = await app.request("/v1/openapi.json");
		expect(res.status).toBe(200);
		const spec = (await res.json()) as { paths: Record<string, unknown> };
		for (const path of Object.keys(spec.paths)) {
			expect(path.includes("/extended"), path).toBe(false);
		}
	});
});

describe("extended response conformance", () => {
	test("GET /extended/v1/status", async () => {
		const res = await injectedApp().request("/extended/v1/status");
		expect(res.status).toBe(200);
		expect(statusSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/block", async () => {
		const res = await injectedApp().request(
			"/extended/v1/block?limit=10&offset=0",
		);
		expect(res.status).toBe(200);
		expect(blockListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/block/{hash}", async () => {
		const res = await injectedApp().request("/extended/v1/block/0xblock100");
		expect(res.status).toBe(200);
		expect(blockSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/tx", async () => {
		const res = await injectedApp().request("/extended/v1/tx?limit=5&offset=0");
		expect(res.status).toBe(200);
		expect(txListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/tx/{tx_id}", async () => {
		const res = await injectedApp().request("/extended/v1/tx/0xabc");
		expect(res.status).toBe(200);
		expect(txSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/tx/{tx_id}/events", async () => {
		const res = await injectedApp().request("/extended/v1/tx/0xabc/events");
		expect(res.status).toBe(200);
		expect(txEventArraySchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/address/{principal}/transactions", async () => {
		const res = await injectedApp().request(
			"/extended/v1/address/SP1SENDER/transactions?limit=10&offset=0",
		);
		expect(res.status).toBe(200);
		expect(txListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/address/{principal}/stx", async () => {
		const res = await injectedApp().request("/extended/v1/address/SP1/stx");
		expect(res.status).toBe(200);
		expect(stxSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/address/{principal}/ft", async () => {
		const res = await injectedApp().request(
			"/extended/v1/address/SP1/ft?limit=10&offset=0",
		);
		expect(res.status).toBe(200);
		expect(ftHoldingsListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/address/{principal}/nft", async () => {
		const res = await injectedApp().request("/extended/v1/address/SP1/nft");
		expect(res.status).toBe(200);
		expect(nftHoldingsListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/names", async () => {
		const res = await injectedApp().request(
			"/extended/v1/names?address=SP1OWNER",
		);
		expect(res.status).toBe(200);
		expect(bnsNameListSchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/names decoder-off empty list", async () => {
		const res = await injectedApp(false).request(
			"/extended/v1/names?address=SP1OWNER",
		);
		expect(res.status).toBe(200);
		expect(bnsNameListSchema.parse(await res.json())).toEqual({
			limit: 20,
			offset: 0,
			total: 0,
			results: [],
		});
	});

	test("GET /extended/v1/names/{name}", async () => {
		const res = await injectedApp().request("/extended/v1/names/alice.btc");
		expect(res.status).toBe(200);
		expect(bnsNameOrEmptySchema.parse(await res.json())).toBeTruthy();
	});

	test("GET /extended/v1/names/{name} decoder-off {}", async () => {
		const res = await injectedApp(false).request(
			"/extended/v1/names/alice.btc",
		);
		expect(res.status).toBe(200);
		expect(bnsNameOrEmptySchema.parse(await res.json())).toEqual({});
	});

	test("GET /extended/v1/tokens/nft/transfers", async () => {
		const res = await injectedApp().request(
			"/extended/v1/tokens/nft/transfers",
		);
		expect(res.status).toBe(200);
		expect(nftTransferListSchema.parse(await res.json())).toBeTruthy();
	});
});

describe("subset schemas reject Index / kitchen-sink leaks", () => {
	test("list schema rejects next_cursor", () => {
		const bad = {
			limit: 10,
			offset: 0,
			total: 0,
			results: [],
			next_cursor: "1:0",
		};
		expect(blockListSchema.safeParse(bad).success).toBe(false);
		expect(txListSchema.safeParse(bad).success).toBe(false);
	});

	test("stx schema rejects nonce", () => {
		const bad = {
			balance: "0",
			total_sent: "0",
			total_received: "0",
			nonce: 1,
		};
		expect(stxSchema.safeParse(bad).success).toBe(false);
	});

	test("block schema rejects miner_txid", () => {
		const bad = { ...BLOCK, miner_txid: "0xminer" };
		expect(blockSchema.safeParse(bad).success).toBe(false);
	});
});
