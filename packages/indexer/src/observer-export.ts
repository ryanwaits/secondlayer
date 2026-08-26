import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { type ObserverPath, parseObserverBody } from "./observer-journal.ts";

export type SbaObserverMessage = {
	path: ObserverPath;
	payload: unknown;
	/** sha256 of raw_body bytes (journal column), not re-serialized JSON */
	content_sha256: string;
	block_height: number | null;
	index_block_hash: string | null;
	received_at?: string;
};

export type ObserverJournalExportRow = {
	sequence: string;
	path: string;
	raw_body: Uint8Array | Buffer;
	raw_body_sha256: string;
	block_height: number | null;
	block_hash: string | null;
	received_at: Date | string;
	status: string;
};

export type ListObserverMessagesOpts = {
	network: string;
	afterHeight?: number;
	afterIndexBlockHash?: string;
	limit: number;
	paths?: ObserverPath[];
};

export type FilterObserverExportOpts = {
	afterHeight?: number;
	afterIndexBlockHash?: string;
	limit: number;
	paths?: ObserverPath[];
};

export function messageFromRow(
	row: ObserverJournalExportRow,
): SbaObserverMessage {
	const payload = parseObserverBody<Record<string, unknown>>(row.raw_body);
	const indexBlockHash = payload.index_block_hash;
	const receivedAt =
		row.received_at instanceof Date
			? row.received_at.toISOString()
			: String(row.received_at);

	return {
		path: row.path as ObserverPath,
		payload,
		content_sha256: row.raw_body_sha256,
		block_height: row.block_height,
		index_block_hash:
			typeof indexBlockHash === "string" ? indexBlockHash : null,
		received_at: receivedAt,
	};
}

function compareHeightSequence(
	a: ObserverJournalExportRow,
	b: ObserverJournalExportRow,
): number {
	const ah = a.block_height as number;
	const bh = b.block_height as number;
	if (ah !== bh) return ah - bh;
	if (a.sequence < b.sequence) return -1;
	if (a.sequence > b.sequence) return 1;
	return 0;
}

function payloadIndexBlockHash(rawBody: Uint8Array | Buffer): string | null {
	const payload = parseObserverBody<Record<string, unknown>>(rawBody);
	return typeof payload.index_block_hash === "string"
		? payload.index_block_hash
		: null;
}

/** Pure cursor/filter over already-fetched journal rows. No PG required. */
export function filterObserverExportRows(
	rows: readonly ObserverJournalExportRow[],
	opts: FilterObserverExportOpts,
): ObserverJournalExportRow[] {
	let filtered = rows.filter(
		(row) => row.status === "processed" && row.block_height != null,
	);

	if (opts.paths && opts.paths.length > 0) {
		const allowed = new Set(opts.paths);
		filtered = filtered.filter((row) => allowed.has(row.path as ObserverPath));
	}

	filtered = [...filtered].sort(compareHeightSequence);

	const afterHeight = opts.afterHeight;
	if (opts.afterIndexBlockHash) {
		const cursorIdx = filtered.findIndex((row) => {
			if (afterHeight != null && row.block_height !== afterHeight) {
				return false;
			}
			return payloadIndexBlockHash(row.raw_body) === opts.afterIndexBlockHash;
		});
		if (cursorIdx >= 0) {
			filtered = filtered.slice(cursorIdx + 1);
		} else if (afterHeight != null) {
			filtered = filtered.filter(
				(row) => (row.block_height as number) > afterHeight,
			);
		}
	} else if (afterHeight != null) {
		filtered = filtered.filter(
			(row) => (row.block_height as number) > afterHeight,
		);
	}

	return filtered.slice(0, opts.limit);
}

export async function listObserverMessages(
	db: Kysely<Database>,
	opts: ListObserverMessagesOpts,
): Promise<SbaObserverMessage[]> {
	let query = db
		.selectFrom("observer_journal")
		.select([
			"sequence",
			"path",
			"raw_body",
			"raw_body_sha256",
			"block_height",
			"block_hash",
			"received_at",
			"status",
		])
		.where("network", "=", opts.network)
		.where("status", "=", "processed")
		.where("block_height", "is not", null);

	if (opts.paths && opts.paths.length > 0) {
		query = query.where("path", "in", opts.paths);
	}

	if (opts.afterHeight != null && opts.afterIndexBlockHash == null) {
		query = query.where("block_height", ">", opts.afterHeight);
	} else if (opts.afterHeight != null) {
		query = query.where("block_height", ">=", opts.afterHeight);
	}

	const rows = await query
		.orderBy("block_height", "asc")
		.orderBy("sequence", "asc")
		.limit(opts.afterIndexBlockHash ? opts.limit + 256 : opts.limit)
		.execute();

	const mapped: ObserverJournalExportRow[] = rows.map((row) => ({
		sequence: String(row.sequence),
		path: row.path,
		raw_body: row.raw_body,
		raw_body_sha256: row.raw_body_sha256,
		block_height: row.block_height,
		block_hash: row.block_hash,
		received_at: row.received_at,
		status: row.status,
	}));

	return filterObserverExportRows(mapped, {
		afterHeight: opts.afterHeight,
		afterIndexBlockHash: opts.afterIndexBlockHash,
		limit: opts.limit,
		paths: opts.paths,
	}).map(messageFromRow);
}

export function writeObserverDump(
	messages: readonly SbaObserverMessage[],
	writable: { write(chunk: string): void },
): void {
	for (const message of messages) {
		writable.write(`${JSON.stringify(message)}\n`);
	}
}
