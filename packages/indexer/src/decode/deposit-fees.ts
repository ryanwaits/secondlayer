import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import type { RawTransaction } from "./bitcoin-rpc.ts";

/**
 * sBTC deposit fees, read from Bitcoin. A `completed-deposit` print carries the
 * minted amount but not what the signers took, so:
 *
 * - `fee` = the deposit output's value − the minted amount.
 * - `max_fee` = the first 8 bytes (big-endian) of the deposit script's data
 *   push, revealed in the sweep tx's witness when the signers spend it.
 *
 * Runs inside the settlement confirmer's tick (the stack's one Bitcoin RPC
 * worker), so stacks without Bitcoin RPC leave both null.
 */

export type DepositTxReader = {
	getRawTransaction(txid: string): Promise<RawTransaction | null>;
};

type PendingDeposit = {
	cursor: string;
	bitcoin_txid: string;
	output_index: number;
	amount: string;
	sweep_txid: string | null;
};

function bare(txid: string): string {
	return txid.startsWith("0x") ? txid.slice(2) : txid;
}

/** Deposit output value − minted amount, in sats. Null when the output is missing. */
export function depositFee(
	depositTx: RawTransaction,
	outputIndex: number,
	amount: string,
): string | null {
	const output = depositTx.vout.find((o) => o.n === outputIndex);
	if (!output) return null;
	const valueSats = BigInt(Math.round(output.value * 1e8));
	const fee = valueSats - BigInt(amount);
	return fee >= 0n ? fee.toString() : null;
}

/**
 * `max_fee` from the deposit script in the sweep input's witness
 * (`[signature, script, control block]`). The script opens with one data push
 * of `max_fee (8 bytes) ‖ recipient`, then OP_DROP. Null for any other shape.
 */
export function depositMaxFee(
	sweepTx: RawTransaction,
	bitcoinTxid: string,
	outputIndex: number,
): string | null {
	const input = sweepTx.vin.find(
		(i) => i.txid === bare(bitcoinTxid) && i.vout === outputIndex,
	);
	const witness = input?.txinwitness;
	if (!witness || witness.length < 2) return null;
	const script = Buffer.from(witness[witness.length - 2] ?? "", "hex");
	const opcode = script[0];
	if (opcode === undefined) return null;
	let start = 1;
	let length = opcode;
	if (opcode === 0x4c) {
		length = script[1] ?? 0;
		start = 2;
	} else if (opcode > 0x4b || opcode === 0) {
		return null;
	}
	if (length < 8 || script[start + length] !== 0x75) return null;
	return script.readBigUInt64BE(start).toString();
}

/** Canonical deposits still missing a fee, newest first. */
async function readPendingDeposits(
	db: Kysely<Database>,
	limit: number,
): Promise<PendingDeposit[]> {
	const rows = await db
		.selectFrom("sbtc_events")
		.select(["cursor", "bitcoin_txid", "output_index", "amount", "sweep_txid"])
		.where("canonical", "=", true)
		.where("topic", "=", "completed-deposit")
		.where("fee", "is", null)
		.where("bitcoin_txid", "is not", null)
		.where("output_index", "is not", null)
		.where("amount", "is not", null)
		.orderBy("block_height", "desc")
		.limit(limit)
		.execute();
	return rows as PendingDeposit[];
}

/** Fill `fee`/`max_fee` on up to `limit` deposits. Returns rows filled. */
export async function fillDepositFees(opts: {
	reader: DepositTxReader;
	db?: Kysely<Database>;
	limit?: number;
	signal?: AbortSignal;
}): Promise<number> {
	const db = opts.db ?? getSourceDb();
	const pending = await readPendingDeposits(db, opts.limit ?? 500);
	// One sweep spends many deposits.
	const sweeps = new Map<string, RawTransaction | null>();
	let filled = 0;
	for (const deposit of pending) {
		if (opts.signal?.aborted) break;
		const depositTx = await opts.reader.getRawTransaction(deposit.bitcoin_txid);
		const fee = depositTx
			? depositFee(depositTx, deposit.output_index, deposit.amount)
			: null;
		if (fee === null) {
			logger.warn("sbtc_deposit_fee.unresolved", {
				cursor: deposit.cursor,
				bitcoin_txid: deposit.bitcoin_txid,
			});
			continue;
		}
		let maxFee: string | null = null;
		if (deposit.sweep_txid) {
			if (!sweeps.has(deposit.sweep_txid)) {
				sweeps.set(
					deposit.sweep_txid,
					await opts.reader.getRawTransaction(deposit.sweep_txid),
				);
			}
			const sweepTx = sweeps.get(deposit.sweep_txid);
			maxFee = sweepTx
				? depositMaxFee(sweepTx, deposit.bitcoin_txid, deposit.output_index)
				: null;
		}
		await db
			.updateTable("sbtc_events")
			.set({ fee, max_fee: maxFee })
			.where("cursor", "=", deposit.cursor)
			.execute();
		filled += 1;
	}
	return filled;
}
