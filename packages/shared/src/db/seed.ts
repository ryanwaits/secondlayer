#!/usr/bin/env bun
/**
 * Seed script — populates the dev database with realistic Stacks blockchain data.
 * Run: bun run seed
 */
import { closeDb, getDb, sql } from "./index.ts";
import { jsonb } from "./jsonb.ts";
const db = getDb();

// ── Helpers ─────────────────────────────────────────────────────────
const randomHex = (len: number) =>
	Array.from({ length: len }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");

const randomHash = () => `0x${randomHex(64)}`;
const randomTxId = () => `0x${randomHex(64)}`;

const stxAddresses = [
	"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
	"SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
	"SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1",
	"SP2C2YFP12AJZB1MADC9PK03NGKJQ8MFGE4ESPDAZ",
	"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9",
	"SP1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE",
];

const contractIds = [
	"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.arkadiko-token",
	"SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-deposit",
	"SP2C2YFP12AJZB1MADC9PK03NGKJQ8MFGE4ESPDAZ.alex-vault",
	"SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.stackingdao-core",
	null,
	null, // some txs have no contract
];

const txTypes = [
	"contract_call",
	"contract_call",
	"contract_call",
	"token_transfer",
	"smart_contract",
];
const fnNames = [
	"transfer",
	"deposit",
	"swap",
	"stake",
	"claim-rewards",
	"mint",
	null,
];
const eventTypes = [
	"stx_transfer",
	"ft_transfer",
	"nft_mint",
	"contract_event",
	"stx_lock",
];

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

console.log("Seeding database...\n");

// ── 1. Accounts ─────────────────────────────────────────────────────
const accountEmails = [
	"ryan@secondlayer.xyz",
	"alice@stacksbuilder.io",
	"bob@defi-labs.com",
	"carol@nft-studio.xyz",
	"dave@stacking.capital",
];

const accountRows = await db
	.insertInto("accounts")
	.values(
		accountEmails.map((email, i) => ({
			email,
			plan: i === 0 ? "pro" : i < 3 ? "builder" : "free",
		})),
	)
	.onConflict((oc) =>
		oc.column("email").doUpdateSet({ email: sql`accounts.email` }),
	)
	.returningAll()
	.execute();

console.log(`  accounts: ${accountRows.length}`);

// ── 2. API Keys ─────────────────────────────────────────────────────
const apiKeyRows = await db
	.insertInto("api_keys")
	.values(
		accountRows.map((a, i) => ({
			key_hash: randomHex(64),
			key_prefix: `sk-sl_${randomHex(4)}`,
			name: `${a.email.split("@")[0]}-key-${i + 1}`,
			account_id: a.id,
			ip_address: `192.168.1.${10 + i}`,
			last_used_at: new Date(),
		})),
	)
	.returningAll()
	.execute();

console.log(`  api_keys: ${apiKeyRows.length}`);

// ── 3. Blocks (200 blocks starting at height 180000) ────────────────
const BLOCK_START = 180000;
const BLOCK_COUNT = 200;
const blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => {
	const height = BLOCK_START + i;
	return {
		height,
		hash: randomHash(),
		parent_hash: randomHash(),
		burn_block_height: 850000 + i,
		timestamp: Math.floor(Date.now() / 1000) - (BLOCK_COUNT - i) * 600, // ~10min apart
		canonical: true,
	};
});

await db
	.insertInto("blocks")
	.values(blocks)
	.onConflict((oc) => oc.column("height").doNothing())
	.execute();
console.log(`  blocks: ${BLOCK_COUNT}`);

// ── 4. Transactions (~3-5 per block) ────────────────────────────────
const txRows: Array<{
	tx_id: string;
	block_height: number;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	raw_tx: string;
}> = [];

for (const block of blocks) {
	const txCount = 3 + Math.floor(Math.random() * 3);
	for (let j = 0; j < txCount; j++) {
		const type = pick(txTypes);
		const contractId = type === "token_transfer" ? null : pick(contractIds);
		txRows.push({
			tx_id: randomTxId(),
			block_height: block.height,
			type,
			sender: pick(stxAddresses),
			status: Math.random() > 0.05 ? "success" : "abort_by_response",
			contract_id: contractId,
			function_name: contractId ? pick(fnNames.filter(Boolean)) : null,
			raw_tx: randomHex(200),
		});
	}
}

// batch insert in chunks
for (let i = 0; i < txRows.length; i += 100) {
	await db
		.insertInto("transactions")
		.values(txRows.slice(i, i + 100))
		.onConflict((oc) => oc.column("tx_id").doNothing())
		.execute();
}
console.log(`  transactions: ${txRows.length}`);

// ── 5. Events (~1-3 per transaction) ────────────────────────────────
const eventRows: Array<{
	tx_id: string;
	block_height: number;
	event_index: number;
	type: string;
	data: ReturnType<typeof jsonb>;
}> = [];

for (const tx of txRows) {
	const eventCount = 1 + Math.floor(Math.random() * 3);
	for (let j = 0; j < eventCount; j++) {
		const type = pick(eventTypes);
		const data: Record<string, unknown> = { type };

		if (type === "stx_transfer" || type === "ft_transfer") {
			data.sender = tx.sender;
			data.recipient = pick(stxAddresses);
			data.amount = String(Math.floor(Math.random() * 10000000));
			if (type === "ft_transfer")
				data.asset_identifier = `${pick(contractIds.filter(Boolean))}::token`;
		} else if (type === "nft_mint") {
			data.recipient = tx.sender;
			data.asset_identifier = `${pick(contractIds.filter(Boolean))}::nft`;
			data.value = {
				type: "uint",
				value: String(Math.floor(Math.random() * 10000)),
			};
		} else if (type === "contract_event") {
			data.contract_identifier = tx.contract_id;
			data.topic = "print";
			data.value = {
				message: "operation completed",
				code: Math.floor(Math.random() * 100),
			};
		} else if (type === "stx_lock") {
			data.locked_amount = String(Math.floor(Math.random() * 50000000000));
			data.unlock_height = tx.block_height + 2100;
			data.locked_address = tx.sender;
		}

		eventRows.push({
			tx_id: tx.tx_id,
			block_height: tx.block_height,
			event_index: j,
			type,
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			data: jsonb(data) as any,
		});
	}
}

for (let i = 0; i < eventRows.length; i += 100) {
	await db
		.insertInto("events")
		.values(eventRows.slice(i, i + 100))
		.execute();
}
console.log(`  events: ${eventRows.length}`);

// ── 6. Subgraphs ───────────────────────────────────────────────────
const subgraphDefs = [
	{
		name: "token-balances",
		def: { tables: ["balances"], source: "ft_transfer" },
		handler: "./subgraphs/token-balances.ts",
	},
	{
		name: "nft-ownership",
		def: { tables: ["owners"], source: "nft_mint" },
		handler: "./subgraphs/nft-ownership.ts",
	},
	{
		name: "stacking-summary",
		def: { tables: ["stacks"], source: "stx_lock" },
		handler: "./subgraphs/stacking-summary.ts",
	},
	{
		name: "contract-activity",
		def: { tables: ["calls"], source: "contract_call" },
		handler: "./subgraphs/contract-activity.ts",
	},
];

await db
	.insertInto("subgraphs")
	.values(
		subgraphDefs.map((v, i) => {
			const key = apiKeyRows[i % apiKeyRows.length];
			const accountPrefix =
				key.account_id?.slice(0, 8) ??
				key.key_prefix.replace("sk-sl_", "").slice(0, 8);
			return {
				name: v.name,
				// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
				definition: jsonb(v.def) as any,
				schema_hash: randomHex(16),
				handler_path: v.handler,
				schema_name: `subgraph_${accountPrefix}_${v.name.replace(/-/g, "_")}`,
				api_key_id: key.id,
				account_id: key.account_id ?? "",
				last_processed_block:
					BLOCK_START + BLOCK_COUNT - 1 - Math.floor(Math.random() * 5),
				total_processed: 1000 + Math.floor(Math.random() * 5000),
				total_errors: Math.floor(Math.random() * 20),
			};
		}),
	)
	.onConflict((oc) => oc.columns(["name", "account_id"]).doNothing())
	.execute();

console.log(`  subgraphs: ${subgraphDefs.length}`);

// ── 7. Index Progress ───────────────────────────────────────────────
await db
	.insertInto("index_progress")
	.values({
		network: "mainnet",
		last_indexed_block: BLOCK_START + BLOCK_COUNT - 1,
		last_contiguous_block: BLOCK_START + BLOCK_COUNT - 1,
		highest_seen_block: BLOCK_START + BLOCK_COUNT + 2,
	})
	.onConflict((oc) =>
		oc.column("network").doUpdateSet({
			last_indexed_block: BLOCK_START + BLOCK_COUNT - 1,
			last_contiguous_block: BLOCK_START + BLOCK_COUNT - 1,
			highest_seen_block: BLOCK_START + BLOCK_COUNT + 2,
		}),
	)
	.execute();

console.log("  index_progress: 1");

// ── 8. Sessions ─────────────────────────────────────────────────────
await db
	.insertInto("sessions")
	.values(
		accountRows.slice(0, 3).map((a) => ({
			token_hash: randomHex(64),
			token_prefix: `sess_${randomHex(4)}`,
			account_id: a.id,
			ip_address: "127.0.0.1",
			last_used_at: new Date(),
		})),
	)
	.execute();

console.log("  sessions: 3");

// ── 9. Usage Daily ──────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

await db
	.insertInto("usage_daily")
	.values(
		accountRows.flatMap((a) => [
			{
				account_id: a.id,
				tenant_id: null,
				date: today,
				api_requests: 50 + Math.floor(Math.random() * 200),
				deliveries: 10 + Math.floor(Math.random() * 100),
			},
			{
				account_id: a.id,
				tenant_id: null,
				date: yesterday,
				api_requests: 80 + Math.floor(Math.random() * 300),
				deliveries: 20 + Math.floor(Math.random() * 150),
			},
		]),
	)
	.onConflict((oc) =>
		oc
			.columns(["account_id", "date"])
			.where("tenant_id", "is", null)
			.doNothing(),
	)
	.execute();

console.log(`  usage_daily: ${accountRows.length * 2}`);

// ── Done ────────────────────────────────────────────────────────────
console.log("\nDone!\n");
await closeDb();
