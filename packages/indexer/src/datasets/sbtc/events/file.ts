import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ParquetWriter } from "@dsnp/parquetjs";
import type { SbtcEventRow } from "./query.ts";
import { createSbtcEventsParquetSchema } from "./schema.ts";

export async function writeSbtcEventsParquet(params: {
	outputPath: string;
	rows: readonly SbtcEventRow[];
	metadata?: Record<string, string>;
}): Promise<void> {
	await mkdir(dirname(params.outputPath), { recursive: true });
	const writer = await ParquetWriter.openFile(
		createSbtcEventsParquetSchema(),
		params.outputPath,
		{ rowGroupSize: 5_000 },
	);
	for (const [key, value] of Object.entries(params.metadata ?? {})) {
		writer.setMetadata(key, value);
	}
	try {
		for (const row of params.rows) {
			await writer.appendRow({
				cursor: row.cursor,
				block_height: row.block_height,
				block_time: row.block_time,
				tx_id: row.tx_id,
				tx_index: row.tx_index,
				event_index: row.event_index,
				topic: row.topic,
				request_id: row.request_id,
				amount: row.amount,
				sender: row.sender,
				recipient_btc_version: row.recipient_btc_version,
				recipient_btc_hashbytes: row.recipient_btc_hashbytes,
				bitcoin_txid: row.bitcoin_txid,
				output_index: row.output_index,
				sweep_txid: row.sweep_txid,
				burn_hash: row.burn_hash,
				burn_height: row.burn_height,
				signer_bitmap: row.signer_bitmap,
				max_fee: row.max_fee,
				fee: row.fee,
				block_height_at_request: row.block_height_at_request,
				governance_contract_type: row.governance_contract_type,
				governance_new_contract: row.governance_new_contract,
				signer_aggregate_pubkey: row.signer_aggregate_pubkey,
				signer_threshold: row.signer_threshold,
				signer_address: row.signer_address,
				signer_keys_count: row.signer_keys_count,
				partition_block_range: row.partition_block_range,
			});
		}
	} finally {
		await writer.close();
	}
}
