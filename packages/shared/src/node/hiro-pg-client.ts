/**
 * Direct Postgres client for reading from a local Hiro API database.
 *
 * Bypasses the Hiro HTTP API entirely — queries the stacks_blockchain_api
 * schema directly. Orders of magnitude faster for bulk backfill since we
 * avoid per-tx HTTP round-trips and the API's slow UNION event queries.
 *
 * Expects HIRO_PG_URL env var pointing to the Hiro API database, e.g.:
 *   postgres://secondlayer:pass@localhost:5432/stacks_blockchain_api
 */

import postgres from "postgres";

const SCHEMA = "stacks_blockchain_api";

// Hiro DB stores bytea; we need 0x-prefixed hex strings
function toHex(buf: Buffer | Uint8Array | null): string {
	if (!buf) return "0x";
	return "0x" + Buffer.from(buf).toString("hex");
}

// asset_event_type_id mapping: 1=transfer, 2=mint, 3=burn
function stxEventType(assetTypeId: number): string {
	switch (assetTypeId) {
		case 1:
			return "stx_transfer_event";
		case 2:
			return "stx_mint_event";
		case 3:
			return "stx_burn_event";
		default:
			return "stx_transfer_event";
	}
}

function ftEventType(assetTypeId: number): string {
	switch (assetTypeId) {
		case 1:
			return "ft_transfer_event";
		case 2:
			return "ft_mint_event";
		case 3:
			return "ft_burn_event";
		default:
			return "ft_transfer_event";
	}
}

function nftEventType(assetTypeId: number): string {
	switch (assetTypeId) {
		case 1:
			return "nft_transfer_event";
		case 2:
			return "nft_mint_event";
		case 3:
			return "nft_burn_event";
		default:
			return "nft_transfer_event";
	}
}

// Hiro tx type_id mapping
function mapTxTypeId(typeId: number): string {
	switch (typeId) {
		case 0:
			return "token_transfer";
		case 1:
			return "smart_contract";
		case 2:
			return "contract_call";
		case 3:
			return "poison_microblock";
		case 4:
			return "coinbase";
		case 5:
			return "coinbase"; // coinbase-pay-to-alt
		case 6:
			return "smart_contract"; // versioned
		case 7:
			return "tenure_change";
		case 8:
			return "coinbase"; // nakamoto coinbase
		default:
			return "token_transfer";
	}
}

// Hiro tx status mapping
function mapTxStatus(status: number): string {
	switch (status) {
		case 1:
			return "success";
		case 0:
			return "abort_by_response";
		default:
			return "abort_by_post_condition";
	}
}

interface BlockRow {
	block_hash: Buffer;
	block_height: number;
	index_block_hash: Buffer;
	parent_block_hash: Buffer;
	parent_index_block_hash: Buffer;
	burn_block_hash: Buffer;
	burn_block_height: number;
	burn_block_time: number;
	block_time: number;
	miner_txid: Buffer;
}

interface TxRow {
	tx_id: Buffer;
	tx_index: number;
	type_id: number;
	status: number;
	sender_address: string;
	raw_tx: Buffer;
	event_count: number;
	contract_call_contract_id: string | null;
	contract_call_function_name: string | null;
	smart_contract_contract_id: string | null;
}

export class HiroPgClient {
	private sql: ReturnType<typeof postgres>;

	constructor(connectionUrl?: string) {
		const url = connectionUrl || process.env.HIRO_PG_URL;
		if (!url) throw new Error("HIRO_PG_URL is required for HiroPgClient");
		this.sql = postgres(url, {
			max: 10,
			idle_timeout: 30,
		});
	}

	async getChainTip(): Promise<number> {
		const rows = await this.sql`
      SELECT MAX(block_height) as tip FROM ${this.sql(SCHEMA)}.blocks WHERE canonical = true
    `;
		return Number(rows[0]?.tip ?? 0);
	}

	/**
	 * Fetch a complete block by height directly from PG.
	 * Returns data in the same NewBlockPayload shape the backfill expects.
	 */
	async getBlockForIndexer(
		height: number,
		options?: { includeRawTx?: boolean },
	): Promise<any | null> {
		// 1. Block metadata
		const blocks = await this.sql<BlockRow[]>`
      SELECT block_hash, block_height, index_block_hash, parent_block_hash,
             parent_index_block_hash, burn_block_hash, burn_block_height,
             burn_block_time, block_time, miner_txid
      FROM ${this.sql(SCHEMA)}.blocks
      WHERE block_height = ${height} AND canonical = true
      LIMIT 1
    `;
		if (blocks.length === 0) return null;
		const block = blocks[0];

		// 2. Transactions
		const txs = await this.sql<TxRow[]>`
      SELECT tx_id, tx_index, type_id, status, sender_address, raw_tx, event_count,
             contract_call_contract_id, contract_call_function_name, smart_contract_contract_id
      FROM ${this.sql(SCHEMA)}.txs
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY tx_index
    `;

		const transactions = txs.map((tx) => {
			const txType = mapTxTypeId(tx.type_id);
			const entry: any = {
				txid: toHex(tx.tx_id),
				raw_tx: options?.includeRawTx ? toHex(tx.raw_tx) : "0x00",
				status: mapTxStatus(tx.status),
				tx_index: tx.tx_index,
				tx_type: txType,
				sender_address: tx.sender_address,
			};
			if (txType === "contract_call" && tx.contract_call_contract_id) {
				entry.contract_call = {
					contract_id: tx.contract_call_contract_id,
					function_name: tx.contract_call_function_name || "",
				};
			} else if (txType === "smart_contract" && tx.smart_contract_contract_id) {
				entry.smart_contract = {
					contract_id: tx.smart_contract_contract_id,
				};
			}
			return entry;
		});

		// 3. Events — query all event tables by block_height (fast, indexed)
		const events: any[] = [];

		// STX events
		const stxEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, amount, sender, recipient, memo
      FROM ${this.sql(SCHEMA)}.stx_events
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY event_index
    `;
		for (const e of stxEvents) {
			const type = stxEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			if (type === "stx_transfer_event") {
				evt.stx_transfer_event = {
					sender: e.sender || "",
					recipient: e.recipient || "",
					amount: String(e.amount),
					...(e.memo ? { memo: toHex(e.memo) } : {}),
				};
			} else if (type === "stx_mint_event") {
				evt.stx_mint_event = {
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "stx_burn_event") {
				evt.stx_burn_event = {
					sender: e.sender || "",
					amount: String(e.amount),
				};
			}
			events.push(evt);
		}

		// STX lock events
		const lockEvents = await this.sql`
      SELECT tx_id, event_index, locked_amount, unlock_height, locked_address
      FROM ${this.sql(SCHEMA)}.stx_lock_events
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY event_index
    `;
		for (const e of lockEvents) {
			events.push({
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type: "stx_lock_event",
				stx_lock_event: {
					locked_amount: String(e.locked_amount),
					unlock_height: String(e.unlock_height),
					locked_address: e.locked_address,
				},
			});
		}

		// FT events
		const ftEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, asset_identifier, amount, sender, recipient
      FROM ${this.sql(SCHEMA)}.ft_events
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY event_index
    `;
		for (const e of ftEvents) {
			const type = ftEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			if (type === "ft_transfer_event") {
				evt.ft_transfer_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "ft_mint_event") {
				evt.ft_mint_event = {
					asset_identifier: e.asset_identifier,
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "ft_burn_event") {
				evt.ft_burn_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					amount: String(e.amount),
				};
			}
			events.push(evt);
		}

		// NFT events
		const nftEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, asset_identifier, value, sender, recipient
      FROM ${this.sql(SCHEMA)}.nft_events
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY event_index
    `;
		for (const e of nftEvents) {
			const type = nftEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			const val = toHex(e.value);
			if (type === "nft_transfer_event") {
				evt.nft_transfer_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					recipient: e.recipient || "",
					value: val,
				};
			} else if (type === "nft_mint_event") {
				evt.nft_mint_event = {
					asset_identifier: e.asset_identifier,
					recipient: e.recipient || "",
					value: val,
				};
			} else if (type === "nft_burn_event") {
				evt.nft_burn_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					value: val,
				};
			}
			events.push(evt);
		}

		// Contract log events
		const logEvents = await this.sql`
      SELECT tx_id, event_index, contract_identifier, topic, value
      FROM ${this.sql(SCHEMA)}.contract_logs
      WHERE block_height = ${height} AND canonical = true AND microblock_canonical = true
      ORDER BY event_index
    `;
		for (const e of logEvents) {
			events.push({
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type: "smart_contract_event",
				smart_contract_event: {
					contract_identifier: e.contract_identifier,
					topic: e.topic,
					value: toHex(e.value),
				},
			});
		}

		return {
			block_hash: toHex(block.block_hash),
			block_height: block.block_height,
			index_block_hash: toHex(block.index_block_hash),
			parent_block_hash: toHex(block.parent_block_hash),
			parent_index_block_hash: toHex(block.parent_index_block_hash),
			burn_block_hash: toHex(block.burn_block_hash),
			burn_block_height: block.burn_block_height,
			burn_block_timestamp: block.burn_block_time,
			miner_txid: toHex(block.miner_txid),
			timestamp: block.block_time,
			transactions,
			events,
		};
	}

	/**
	 * Fetch multiple blocks in bulk — 6 queries total instead of 6 per block.
	 * Returns array of NewBlockPayload in height order.
	 */
	async getBlockBatch(
		heights: number[],
		options?: { includeRawTx?: boolean },
	): Promise<any[]> {
		if (heights.length === 0) return [];

		// 1. All blocks in range
		const blocks = await this.sql`
      SELECT block_hash, block_height, index_block_hash, parent_block_hash,
             parent_index_block_hash, burn_block_hash, burn_block_height,
             burn_block_time, block_time, miner_txid
      FROM ${this.sql(SCHEMA)}.blocks
      WHERE block_height = ANY(${heights}) AND canonical = true
    `;

		if (blocks.length === 0) return [];
		const blockMap = new Map<number, any>();
		for (const b of blocks) {
			blockMap.set(b.block_height, { ...b, transactions: [], events: [] });
		}

		// 2. All transactions
		const txs = await this.sql`
      SELECT tx_id, tx_index, type_id, status, sender_address, raw_tx, event_count, block_height,
             contract_call_contract_id, contract_call_function_name, smart_contract_contract_id
      FROM ${this.sql(SCHEMA)}.txs
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
      ORDER BY block_height, tx_index
    `;
		for (const tx of txs) {
			const block = blockMap.get(tx.block_height);
			if (!block) continue;
			const txType = mapTxTypeId(tx.type_id);
			const entry: any = {
				txid: toHex(tx.tx_id),
				raw_tx: options?.includeRawTx ? toHex(tx.raw_tx) : "0x00",
				status: mapTxStatus(tx.status),
				tx_index: tx.tx_index,
				tx_type: txType,
				sender_address: tx.sender_address,
			};
			if (txType === "contract_call" && tx.contract_call_contract_id) {
				entry.contract_call = {
					contract_id: tx.contract_call_contract_id,
					function_name: tx.contract_call_function_name || "",
				};
			} else if (txType === "smart_contract" && tx.smart_contract_contract_id) {
				entry.smart_contract = { contract_id: tx.smart_contract_contract_id };
			}
			block.transactions.push(entry);
		}

		// 3. STX events
		const stxEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, amount, sender, recipient, memo, block_height
      FROM ${this.sql(SCHEMA)}.stx_events
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
    `;
		for (const e of stxEvents) {
			const block = blockMap.get(e.block_height);
			if (!block) continue;
			const type = stxEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			if (type === "stx_transfer_event") {
				evt.stx_transfer_event = {
					sender: e.sender || "",
					recipient: e.recipient || "",
					amount: String(e.amount),
					...(e.memo ? { memo: toHex(e.memo) } : {}),
				};
			} else if (type === "stx_mint_event") {
				evt.stx_mint_event = {
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "stx_burn_event") {
				evt.stx_burn_event = {
					sender: e.sender || "",
					amount: String(e.amount),
				};
			}
			block.events.push(evt);
		}

		// 4. STX lock events
		const lockEvents = await this.sql`
      SELECT tx_id, event_index, locked_amount, unlock_height, locked_address, block_height
      FROM ${this.sql(SCHEMA)}.stx_lock_events
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
    `;
		for (const e of lockEvents) {
			const block = blockMap.get(e.block_height);
			if (!block) continue;
			block.events.push({
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type: "stx_lock_event",
				stx_lock_event: {
					locked_amount: String(e.locked_amount),
					unlock_height: String(e.unlock_height),
					locked_address: e.locked_address,
				},
			});
		}

		// 5. FT events
		const ftEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, asset_identifier, amount, sender, recipient, block_height
      FROM ${this.sql(SCHEMA)}.ft_events
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
    `;
		for (const e of ftEvents) {
			const block = blockMap.get(e.block_height);
			if (!block) continue;
			const type = ftEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			if (type === "ft_transfer_event") {
				evt.ft_transfer_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "ft_mint_event") {
				evt.ft_mint_event = {
					asset_identifier: e.asset_identifier,
					recipient: e.recipient || "",
					amount: String(e.amount),
				};
			} else if (type === "ft_burn_event") {
				evt.ft_burn_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					amount: String(e.amount),
				};
			}
			block.events.push(evt);
		}

		// 6. NFT events
		const nftEvents = await this.sql`
      SELECT tx_id, event_index, asset_event_type_id, asset_identifier, value, sender, recipient, block_height
      FROM ${this.sql(SCHEMA)}.nft_events
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
    `;
		for (const e of nftEvents) {
			const block = blockMap.get(e.block_height);
			if (!block) continue;
			const type = nftEventType(e.asset_event_type_id);
			const evt: any = {
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type,
			};
			const val = toHex(e.value);
			if (type === "nft_transfer_event") {
				evt.nft_transfer_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					recipient: e.recipient || "",
					value: val,
				};
			} else if (type === "nft_mint_event") {
				evt.nft_mint_event = {
					asset_identifier: e.asset_identifier,
					recipient: e.recipient || "",
					value: val,
				};
			} else if (type === "nft_burn_event") {
				evt.nft_burn_event = {
					asset_identifier: e.asset_identifier,
					sender: e.sender || "",
					value: val,
				};
			}
			block.events.push(evt);
		}

		// 7. Contract log events
		const logEvents = await this.sql`
      SELECT tx_id, event_index, contract_identifier, topic, value, block_height
      FROM ${this.sql(SCHEMA)}.contract_logs
      WHERE block_height = ANY(${heights}) AND canonical = true AND microblock_canonical = true
    `;
		for (const e of logEvents) {
			const block = blockMap.get(e.block_height);
			if (!block) continue;
			block.events.push({
				txid: toHex(e.tx_id),
				event_index: e.event_index,
				committed: true,
				type: "smart_contract_event",
				smart_contract_event: {
					contract_identifier: e.contract_identifier,
					topic: e.topic,
					value: toHex(e.value),
				},
			});
		}

		// Build results in height order
		return heights
			.filter((h) => blockMap.has(h))
			.map((h) => {
				const b = blockMap.get(h)!;
				return {
					block_hash: toHex(b.block_hash),
					block_height: b.block_height,
					index_block_hash: toHex(b.index_block_hash),
					parent_block_hash: toHex(b.parent_block_hash),
					parent_index_block_hash: toHex(b.parent_index_block_hash),
					burn_block_hash: toHex(b.burn_block_hash),
					burn_block_height: b.burn_block_height,
					burn_block_timestamp: b.burn_block_time,
					miner_txid: toHex(b.miner_txid),
					timestamp: b.block_time,
					transactions: b.transactions,
					events: b.events,
				};
			});
	}

	async close(): Promise<void> {
		await this.sql.end();
	}
}
