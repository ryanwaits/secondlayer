// `cli.ts repair-entries` (plan 040 step 2): backfills `symbol_codepoint`
// and `has_terms` (migration 0003) on `rune_entries` rows written before
// those columns existed. Split into a pure per-row decision
// (`resolveRepairForRow`, unit-testable with a stub RPC, no DB) and thin DB
// glue (`repairEntries`) that scans/writes Postgres — same split as
// `computeBalanceChanges`/`flush` in ./db/store.ts.

import { type Kysely, sql } from "kysely";
import { parseTransaction } from "./block.ts";
import { chunk } from "./db/store.ts";
import type { Database } from "./db/types.ts";
import { runeIdToString } from "./runes/rune_id.ts";
import { runestoneDecipher } from "./runes/runestone.ts";
import {
	UNCOMMON_GOODS_RUNE_ID,
	createRuneState,
	seedGenesis,
} from "./runes/state.ts";

/** Minimal shape `resolveRepairForRow` needs from a `rune_entries` row — narrower than `RuneEntriesTable` so tests don't need a full row. */
export interface RepairSourceRow {
	runeId: string;
	etchingTxid: string;
	/** The existing (lossy) `symbol` text column: null means "no symbol" OR "lost U+0000" — ambiguous, see migration 0003. */
	symbol: string | null;
	/** Whether ANY `terms_*` column is non-null: true means "has terms" for certain; false is ambiguous ("no terms" OR "terms, all fields empty"). */
	termsColumnsAnyNonNull: boolean;
}

export interface RepairOutcome {
	runeId: string;
	symbolCodepoint: number | null;
	hasTerms: boolean;
	/** Whether resolving this row required an RPC round trip. */
	usedRpc: boolean;
}

/** The one RPC shape this module needs: raw tx hex (`getrawtransaction <txid> false`) — this module parses and deciphers it itself rather than trusting bitcoind's verbose decode. */
export interface EtchingTxFetcher {
	getRawTx(txid: string): Promise<string>;
}

/**
 * A re-decipher disagreeing with a non-null stored `symbol`/`terms` column
 * is plan 040's STOP condition — it means a deeper bug (the original decode
 * or this repair's decode is wrong), not something to silently paper over.
 */
export class RepairDisagreementError extends Error {
	constructor(
		readonly runeId: string,
		message: string,
	) {
		super(`repair-entries: ${runeId}: ${message}`);
		this.name = "RepairDisagreementError";
	}
}

const GENESIS_RUNE_ID = runeIdToString(UNCOMMON_GOODS_RUNE_ID);

/** UNCOMMON•GOODS's entry, straight from `seedGenesis` — the single source of truth this repair uses for rune 1:0, with no RPC. */
function genesisEntry() {
	const state = createRuneState();
	seedGenesis(state);
	const entry = state.entries.get(GENESIS_RUNE_ID);
	if (!entry) throw new Error("seedGenesis did not seed rune 1:0");
	return entry;
}

/**
 * Resolves one row's `symbol_codepoint`/`has_terms`: from column data alone
 * when that's already unambiguous, else by re-fetching and re-deciphering
 * the etching tx.
 */
export async function resolveRepairForRow(
	row: RepairSourceRow,
	fetcher: EtchingTxFetcher,
): Promise<RepairOutcome> {
	if (row.runeId === GENESIS_RUNE_ID) {
		const entry = genesisEntry();
		return {
			runeId: row.runeId,
			symbolCodepoint:
				entry.symbol !== undefined
					? (entry.symbol.codePointAt(0) ?? null)
					: null,
			hasTerms: entry.terms !== undefined,
			usedRpc: false,
		};
	}

	const symbolKnown = row.symbol !== null;
	const termsKnown = row.termsColumnsAnyNonNull;
	const knownSymbolCodepoint = row.symbol?.codePointAt(0) ?? null;

	if (symbolKnown && termsKnown) {
		return {
			runeId: row.runeId,
			symbolCodepoint: knownSymbolCodepoint,
			hasTerms: true,
			usedRpc: false,
		};
	}

	// At least one of symbol/terms is ambiguous from columns alone — resolve
	// both authoritatively by re-deciphering the etching tx.
	const hex = await fetcher.getRawTx(row.etchingTxid);
	const tx = parseTransaction(hex);
	const artifact = runestoneDecipher(tx);

	// A cenotaph (or no runestone at all, which shouldn't happen for a real
	// etching txid but is handled the same way) has no etching to read.
	const decodedEtching =
		artifact !== undefined && artifact.type === "runestone"
			? artifact.runestone.etching
			: undefined;
	const decodedSymbolCodepoint =
		decodedEtching?.symbol !== undefined
			? (decodedEtching.symbol.codePointAt(0) ?? null)
			: null;
	const decodedHasTerms = decodedEtching?.terms !== undefined;

	if (symbolKnown && knownSymbolCodepoint !== decodedSymbolCodepoint) {
		throw new RepairDisagreementError(
			row.runeId,
			`stored symbol codepoint ${knownSymbolCodepoint} disagrees with re-deciphered ${decodedSymbolCodepoint}`,
		);
	}
	if (termsKnown && !decodedHasTerms) {
		throw new RepairDisagreementError(
			row.runeId,
			"stored terms_* columns are non-null but the re-deciphered etching has no terms",
		);
	}

	return {
		runeId: row.runeId,
		symbolCodepoint: symbolKnown
			? knownSymbolCodepoint
			: decodedSymbolCodepoint,
		hasTerms: termsKnown ? true : decodedHasTerms,
		usedRpc: true,
	};
}

/** Bounded-concurrency worker pool — same shape as `cli.ts`'s `parity-decode` pool. */
async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	async function runner(): Promise<void> {
		while (next < items.length) {
			const item = items[next++] as T;
			await worker(item);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, runner),
	);
}

export const REPAIR_UPDATE_CHUNK_SIZE = 5_000;

export interface RepairRowsResult {
	outcomes: RepairOutcome[];
	rowsRepairedNoRpc: number;
	rowsRepairedViaRpc: number;
	rpcCalls: number;
}

/**
 * Resolves a batch of already-fetched (unrepaired) rows at bounded
 * concurrency — pure aside from the RPC calls `fetcher` makes, so it's
 * unit-testable with a stub `fetcher` and no DB. `repairEntries` is this
 * plus the DB scan/write on either side. Passing an empty `rows` array (what
 * `repairEntries`'s `WHERE repaired_at IS NULL` returns once every row has
 * been repaired) makes zero RPC calls — the idempotency guarantee a second
 * `repair-entries` run relies on.
 */
export async function repairRows(
	rows: RepairSourceRow[],
	fetcher: EtchingTxFetcher,
	concurrency = 8,
): Promise<RepairRowsResult> {
	let rpcCalls = 0;
	const countingFetcher: EtchingTxFetcher = {
		getRawTx: (txid) => {
			rpcCalls += 1;
			return fetcher.getRawTx(txid);
		},
	};

	const outcomes: RepairOutcome[] = [];
	await runPool(rows, concurrency, async (row) => {
		outcomes.push(await resolveRepairForRow(row, countingFetcher));
	});

	return {
		outcomes,
		rowsRepairedNoRpc: outcomes.filter((o) => !o.usedRpc).length,
		rowsRepairedViaRpc: outcomes.filter((o) => o.usedRpc).length,
		rpcCalls,
	};
}

export interface RepairStats {
	rowsScanned: number;
	rowsRepairedNoRpc: number;
	rowsRepairedViaRpc: number;
	rpcCalls: number;
	ms: number;
}

/**
 * Scans every `rune_entries` row not yet repaired (`repaired_at IS NULL`),
 * resolves each with `repairRows` at bounded concurrency, and writes
 * `symbol_codepoint`/`has_terms`/`repaired_at` back in batched updates.
 * Idempotent: `repaired_at IS NULL` never matches an already-repaired row
 * (or a row `entryToRow` wrote after migration 0003 — those always carry
 * `repaired_at` from the moment they're inserted), so a second run selects
 * zero rows and (per `repairRows`) makes zero RPC calls.
 */
export async function repairEntries(
	db: Kysely<Database>,
	fetcher: EtchingTxFetcher,
	concurrency = 8,
): Promise<RepairStats> {
	const start = performance.now();

	const dbRows = await db
		.selectFrom("rune_entries")
		.select([
			"rune_id",
			"etching_txid",
			"symbol",
			"terms_amount",
			"terms_cap",
			"terms_height_start",
			"terms_height_end",
			"terms_offset_start",
			"terms_offset_end",
		])
		.where("repaired_at", "is", null)
		.execute();

	const rows: RepairSourceRow[] = dbRows.map((row) => ({
		runeId: row.rune_id,
		etchingTxid: row.etching_txid,
		symbol: row.symbol,
		termsColumnsAnyNonNull:
			row.terms_amount !== null ||
			row.terms_cap !== null ||
			row.terms_height_start !== null ||
			row.terms_height_end !== null ||
			row.terms_offset_start !== null ||
			row.terms_offset_end !== null,
	}));

	const { outcomes, rowsRepairedNoRpc, rowsRepairedViaRpc, rpcCalls } =
		await repairRows(rows, fetcher, concurrency);

	// Batched updates via `unnest`, one round trip per chunk — same pattern as
	// the balance-delete batching in ./db/store.ts.
	for (const batch of chunk(outcomes, REPAIR_UPDATE_CHUNK_SIZE)) {
		const runeIds = batch.map((o) => o.runeId);
		const symbolCodepoints = batch.map((o) => o.symbolCodepoint);
		const hasTermsFlags = batch.map((o) => o.hasTerms);
		await sql`
			update rune_entries r
			set symbol_codepoint = d.symbol_codepoint,
				has_terms = d.has_terms,
				repaired_at = now()
			from unnest(
				${sql.val(runeIds)}::text[],
				${sql.val(symbolCodepoints)}::int[],
				${sql.val(hasTermsFlags)}::bool[]
			) as d(rune_id, symbol_codepoint, has_terms)
			where r.rune_id = d.rune_id
		`.execute(db);
	}

	return {
		rowsScanned: rows.length,
		rowsRepairedNoRpc,
		rowsRepairedViaRpc,
		rpcCalls,
		ms: performance.now() - start,
	};
}
