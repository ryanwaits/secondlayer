import { createHash } from "node:crypto";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { Cl, serializeCVBytes } from "@secondlayer/stacks/clarity";
import type { Kysely } from "kysely";
import type { RawTransaction } from "./bitcoin-rpc.ts";

/**
 * sBTC deposit fees, read from Bitcoin. A `completed-deposit` print carries the
 * minted amount but not what the signers took, so:
 *
 * - `fee` = the deposit output's value − the minted amount.
 * - `max_fee` comes from the sweep tx's witness, where the signers reveal the
 *   deposit script. A v1 script carries it as the first 8 bytes of its data
 *   push. A v2 script carries only a hash, so it is found by hashing candidate
 *   values with the deposit's recipient until one matches (see `v2MaxFee`).
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
	recipient: string | null;
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

/** `OP_SIZE 0x20 OP_EQUALVERIFY OP_SHA256 <push 32>`: how a v2 deposit script opens. */
const V2_SCRIPT_PREFIX = Buffer.from("82012088a820", "hex");
/** Every miner deposit allows 80,000 sats, so it is tried first. */
const COMMON_MAX_FEE = 80_000n;
/** Highest `max_fee` searched for (0.01 BTC). A full miss costs about 300 ms. */
const MAX_FEE_SEARCH_CEILING = 1_000_000n;

function sha256(bytes: Uint8Array): Buffer {
	return createHash("sha256").update(bytes).digest();
}

/** v1: the script opens with one push of `max_fee (8 bytes) ‖ recipient`, then OP_DROP. */
function v1MaxFee(script: Buffer): string | null {
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

/**
 * v2: the script holds only `SHA256(preimage)`, and the sweep reveals
 * `preimage = SHA256(max_fee (8 bytes) ‖ recipient)`. The recipient is known
 * from the mint and the signers never take more than `max_fee`, so candidates
 * are hashed from `fee` upward until one matches.
 */
function v2MaxFee(
	script: Buffer,
	preimageHex: string | undefined,
	known: { recipient: string | null; fee: string },
): string | null {
	if (!known.recipient || preimageHex?.length !== 64) return null;
	if (
		script.length < 39 ||
		!script.subarray(0, 6).equals(V2_SCRIPT_PREFIX) ||
		script[38] !== 0x88
	) {
		return null;
	}
	const preimage = Buffer.from(preimageHex, "hex");
	if (!sha256(preimage).equals(script.subarray(6, 38))) return null;
	let principal: Uint8Array;
	try {
		principal = serializeCVBytes(Cl.principal(known.recipient));
	} catch {
		return null;
	}
	const message = Buffer.alloc(8 + principal.length);
	message.set(principal, 8);
	const matches = (maxFee: bigint) => {
		message.writeBigUInt64BE(maxFee);
		return sha256(message).equals(preimage);
	};
	if (matches(COMMON_MAX_FEE)) return COMMON_MAX_FEE.toString();
	for (
		let maxFee = BigInt(known.fee);
		maxFee <= MAX_FEE_SEARCH_CEILING;
		maxFee++
	) {
		if (matches(maxFee)) return maxFee.toString();
	}
	return null;
}

/**
 * `max_fee` of the deposit a sweep input spends. The witness ends with
 * `[…, script, control block]`. A v2 script starts with OP_SIZE and a v1
 * script with a push, so the script itself says which format it is: no
 * activation height is involved. Null for any other shape.
 */
export function depositMaxFee(
	sweepTx: RawTransaction,
	bitcoinTxid: string,
	outputIndex: number,
	known: { recipient: string | null; fee: string },
): string | null {
	const input = sweepTx.vin.find(
		(i) => i.txid === bare(bitcoinTxid) && i.vout === outputIndex,
	);
	const witness = input?.txinwitness;
	if (!witness || witness.length < 2) return null;
	const script = Buffer.from(witness[witness.length - 2] ?? "", "hex");
	if (script[0] === 0x82) {
		return v2MaxFee(script, witness[witness.length - 3], known);
	}
	return v1MaxFee(script);
}

/**
 * Deposits whose sweep was read but gave no `max_fee`. They are skipped until
 * the process restarts, so one unreadable script is not re-read every tick.
 */
const unreadableMaxFee = new Set<string>();

/**
 * Canonical deposits still missing a fee, or missing only `max_fee` while
 * their sweep is known, newest first.
 */
async function readPendingDeposits(
	db: Kysely<Database>,
	limit: number,
	skip: ReadonlySet<string>,
): Promise<PendingDeposit[]> {
	let query = db
		.selectFrom("sbtc_events")
		.select([
			"cursor",
			"bitcoin_txid",
			"output_index",
			"amount",
			"sweep_txid",
			"recipient",
		])
		.where("canonical", "=", true)
		.where("topic", "=", "completed-deposit")
		.where((eb) =>
			eb.or([
				eb("fee", "is", null),
				eb.and([eb("max_fee", "is", null), eb("sweep_txid", "is not", null)]),
			]),
		)
		.where("bitcoin_txid", "is not", null)
		.where("output_index", "is not", null)
		.where("amount", "is not", null);
	if (skip.size > 0) query = query.where("cursor", "not in", [...skip]);
	const rows = await query
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
	/** Injected by tests. Defaults to the process-wide set. */
	unreadable?: Set<string>;
}): Promise<number> {
	const db = opts.db ?? getSourceDb();
	const unreadable = opts.unreadable ?? unreadableMaxFee;
	const pending = await readPendingDeposits(db, opts.limit ?? 500, unreadable);
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
			if (sweepTx) {
				maxFee = depositMaxFee(
					sweepTx,
					deposit.bitcoin_txid,
					deposit.output_index,
					{ recipient: deposit.recipient, fee },
				);
				// The sweep was read and still gave nothing: retrying cannot help.
				if (maxFee === null) unreadable.add(deposit.cursor);
			}
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
