#!/usr/bin/env bun
/**
 * Replay `observer_journal` rows from one database into another indexer, in
 * the order they arrived. The cutover tool: a database copy frozen at height
 * H0 catches up on everything the old database journaled after H0 by having
 * its own indexer re-receive those exact HTTP bodies.
 *
 * Replays `/new_block` AND `/new_burn_block` bodies in one sequence-ordered
 * pass. Burn blocks matter: the PoX reward tables are written only by
 * `/new_burn_block`, and the node never re-sends them.
 *
 * Which journal rows are sent:
 *   processed  replayed  derived state was committed on the source
 *   received   replayed  journaled but not yet applied when the source stopped;
 *                        the node did send it
 *   failed     skipped   the node re-sent the same bytes; the redelivery is its
 *   retried    skipped   own later row
 *   skipped    skipped   deliberately never applied (refused spool, superseded)
 *   poisoned   skipped   counted and reported; the operator must inspect them
 *
 * The target indexer MUST run with `INGEST_MODE=live` so every reply waits for
 * the apply. A reply of `accepted` (catch-up) or `spooled` (bootstrap) means
 * "journaled, not applied", and the replay stops rather than risk a silent hole.
 *
 * The source database is only ever read, inside a READ ONLY transaction.
 * Dry-run unless `--apply` is given. Strictly serial, never retries: on any
 * failure it stops and prints the `last_sequence` to resume from.
 *
 * Usage:
 *   bun run packages/indexer/src/replay-journal.ts --source-url <postgres url> --indexer-url http://127.0.0.1:3700 --from-sequence 0
 *   bun run packages/indexer/src/replay-journal.ts --source-url <url> --indexer-url <url> --from-height 9500000 --margin 200
 *   bun run packages/indexer/src/replay-journal.ts --source-url <url> --indexer-url <url> --from-sequence 123456 --apply
 */
import { closeDb, getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type ReplayArgs = {
	sourceUrl: string;
	indexerUrl: string;
	network: string;
	/** Exclusive: the last sequence already applied. */
	fromSequence?: string;
	fromHeight?: number;
	margin: number;
	/** Inclusive. */
	toSequence?: string;
	pageSize: number;
	timeoutMs: number;
	apply: boolean;
};

const FLAGS_WITH_VALUE = new Set([
	"--source-url",
	"--indexer-url",
	"--network",
	"--from-sequence",
	"--from-height",
	"--margin",
	"--to-sequence",
	"--page-size",
	"--timeout-ms",
]);

function parseInteger(flag: string, value: string): number {
	if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
	const n = Number(value);
	if (!Number.isSafeInteger(n)) throw new Error(`${flag} is out of range`);
	return n;
}

function parseSequence(flag: string, value: string): string {
	if (!/^\d+$/.test(value)) throw new Error(`${flag} must be digits only`);
	return value;
}

export function parseArgs(argv: string[]): ReplayArgs {
	const values = new Map<string, string>();
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i] as string;
		if (flag === "--apply") {
			apply = true;
		} else if (FLAGS_WITH_VALUE.has(flag)) {
			const value = argv[++i];
			if (value === undefined) throw new Error(`${flag} requires a value`);
			values.set(flag, value);
		} else {
			throw new Error(`Unknown flag: ${flag}`);
		}
	}

	const sourceUrl = values.get("--source-url");
	const indexerUrl = values.get("--indexer-url");
	if (!sourceUrl) throw new Error("--source-url is required");
	if (!indexerUrl) throw new Error("--indexer-url is required");

	const fromSequence = values.get("--from-sequence");
	const fromHeight = values.get("--from-height");
	if ((fromSequence === undefined) === (fromHeight === undefined)) {
		throw new Error("Give exactly one of --from-sequence and --from-height");
	}
	if (fromHeight === undefined && values.has("--margin")) {
		throw new Error("--margin only applies with --from-height");
	}

	const pageSize = values.has("--page-size")
		? parseInteger("--page-size", values.get("--page-size") as string)
		: 500;
	if (pageSize < 1 || pageSize > 5000) {
		throw new Error("--page-size must be within 1..5000");
	}

	const toSequence = values.get("--to-sequence");

	return {
		sourceUrl,
		indexerUrl: indexerUrl.replace(/\/+$/, ""),
		network: values.get("--network") ?? "mainnet",
		fromSequence:
			fromSequence === undefined
				? undefined
				: parseSequence("--from-sequence", fromSequence),
		fromHeight:
			fromHeight === undefined
				? undefined
				: parseInteger("--from-height", fromHeight),
		margin: values.has("--margin")
			? parseInteger("--margin", values.get("--margin") as string)
			: 200,
		toSequence:
			toSequence === undefined
				? undefined
				: parseSequence("--to-sequence", toSequence),
		pageSize,
		timeoutMs: values.has("--timeout-ms")
			? parseInteger("--timeout-ms", values.get("--timeout-ms") as string)
			: 120_000,
		apply,
	};
}

/**
 * Cursor (exclusive) that makes the replay start at the first `/new_block`
 * journal row at or above `fromHeight - margin`; null when none exists.
 *
 * The margin exists because the source and target nodes can have seen
 * different forks near H0, and arrival order carries the fork resolution.
 * Starting a little below H0 replays that resolution; blocks the target
 * already holds just answer `duplicate`.
 *
 * `block_height` is used rather than the parsed body because it is filled on
 * every `processed` row, which covers nearly all rows near H0. Rows still
 * `received` before that point are covered anyway: the replay walks every row
 * by sequence from the cursor onward.
 */
export async function findStartSequence(
	db: Kysely<Database>,
	opts: { network: string; fromHeight: number; margin: number },
): Promise<string | null> {
	const floor = opts.fromHeight - opts.margin;
	const result = await sql<{ s: string | null }>`
		SELECT (min(sequence) - 1)::text AS s
		  FROM observer_journal
		 WHERE network = ${opts.network}
		   AND path = '/new_block'
		   AND block_height >= ${floor}
	`.execute(db);
	return result.rows[0]?.s ?? null;
}

export const REPLAY_PATHS = ["/new_block", "/new_burn_block"] as const;
export const REPLAY_STATUSES = ["processed", "received"] as const;

export type JournalRow = {
	sequence: string;
	path: string;
	status: string;
	raw_body: Buffer;
};

/** One page of journal rows in arrival order, read in a READ ONLY transaction. */
export async function readJournalPage(
	db: Kysely<Database>,
	opts: {
		network: string;
		afterSequence: string;
		toSequence?: string;
		limit: number;
	},
): Promise<JournalRow[]> {
	return db.transaction().execute(async (tx) => {
		await sql`SET TRANSACTION READ ONLY`.execute(tx);
		const upper =
			opts.toSequence === undefined
				? sql``
				: sql`AND sequence <= ${opts.toSequence}::bigint`;
		const result = await sql<JournalRow>`
			SELECT sequence::text AS sequence, path, status, raw_body
			  FROM observer_journal
			 WHERE network = ${opts.network}
			   AND sequence > ${opts.afterSequence}::bigint
			   ${upper}
			   AND path IN (${sql.join([...REPLAY_PATHS])})
			 ORDER BY observer_journal.sequence ASC
			 LIMIT ${opts.limit}
		`.execute(tx);
		return result.rows;
	});
}

const NEW_BLOCK_OK = new Set(["ok", "duplicate", "staged"]);

/** Does this reply mean "applied"? Anything else must stop the replay. */
export function checkReply(
	path: string,
	httpStatus: number,
	body: unknown,
): { ok: true } | { ok: false; reason: string } {
	const status =
		body && typeof body === "object" && "status" in body
			? (body as { status: unknown }).status
			: undefined;
	if (status === "accepted") {
		return {
			ok: false,
			reason:
				'target indexer is in catch-up mode (reply "accepted" = journaled, not applied). Restart it with INGEST_MODE=live and resume from last_sequence.',
		};
	}
	if (status === "spooled") {
		return {
			ok: false,
			reason:
				"target indexer is in bootstrap spool mode; it is not applying blocks.",
		};
	}
	if (httpStatus === 200) {
		if (path === "/new_block" && typeof status === "string") {
			if (NEW_BLOCK_OK.has(status)) return { ok: true };
		}
		if (path === "/new_burn_block" && status === "ok") return { ok: true };
	}
	return {
		ok: false,
		reason: `unexpected reply: HTTP ${httpStatus} ${JSON.stringify(body)?.slice(0, 300)}`,
	};
}

export type ReplaySummary = {
	replayed: number;
	skipped: Record<string, number>;
	lastSequence: string | null;
	byPath: Record<string, number>;
};

export async function replayJournal(opts: {
	db: Kysely<Database>;
	indexerUrl: string;
	network: string;
	afterSequence: string;
	toSequence?: string;
	pageSize: number;
	timeoutMs: number;
	apply: boolean;
	fetchImpl?: typeof fetch;
	log?: (line: string) => void;
}): Promise<ReplaySummary> {
	const doFetch = opts.fetchImpl ?? fetch;
	const log = opts.log ?? ((line: string) => console.log(line));
	const summary: ReplaySummary = {
		replayed: 0,
		skipped: {},
		lastSequence: null,
		byPath: {},
	};
	const replayable = new Set<string>(REPLAY_STATUSES);
	let cursor = opts.afterSequence;

	for (;;) {
		const rows = await readJournalPage(opts.db, {
			network: opts.network,
			afterSequence: cursor,
			toSequence: opts.toSequence,
			limit: opts.pageSize,
		});

		for (const row of rows) {
			cursor = row.sequence;
			if (!replayable.has(row.status)) {
				summary.skipped[row.status] = (summary.skipped[row.status] ?? 0) + 1;
				continue;
			}
			if (!opts.apply) {
				log(`would POST ${row.path} sequence=${row.sequence}`);
			} else {
				const resume = summary.lastSequence ?? opts.afterSequence;
				const fail = (reason: string): never => {
					throw new Error(
						`replay stopped at sequence=${row.sequence} path=${row.path}: ${reason} last_sequence=${resume}`,
					);
				};
				let httpStatus: number;
				let text: string;
				try {
					const res = await doFetch(`${opts.indexerUrl}${row.path}`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-Source": "journal-replay",
						},
						body: row.raw_body,
						signal: AbortSignal.timeout(opts.timeoutMs),
					});
					httpStatus = res.status;
					text = await res.text();
				} catch (error) {
					return fail(
						`request failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(text);
				} catch {
					return fail(
						`reply is not JSON: HTTP ${httpStatus} ${text.slice(0, 300)}`,
					);
				}
				const verdict = checkReply(row.path, httpStatus, parsed);
				if (!verdict.ok) return fail(verdict.reason);
			}
			summary.lastSequence = row.sequence;
			summary.replayed++;
			summary.byPath[row.path] = (summary.byPath[row.path] ?? 0) + 1;
		}

		log(
			`replayed=${summary.replayed} last_sequence=${summary.lastSequence ?? "none"} skipped=${JSON.stringify(summary.skipped)} mode=${opts.apply ? "apply" : "dry-run"}`,
		);
		if (rows.length < opts.pageSize) return summary;
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getDb(args.sourceUrl);

	let afterSequence = args.fromSequence;
	if (afterSequence === undefined) {
		const start = await findStartSequence(db, {
			network: args.network,
			fromHeight: args.fromHeight as number,
			margin: args.margin,
		});
		if (start === null) {
			throw new Error(
				`no journal row at or above height ${(args.fromHeight as number) - args.margin}`,
			);
		}
		afterSequence = start;
	}

	const summary = await replayJournal({
		db,
		indexerUrl: args.indexerUrl,
		network: args.network,
		afterSequence,
		toSequence: args.toSequence,
		pageSize: args.pageSize,
		timeoutMs: args.timeoutMs,
		apply: args.apply,
	});

	console.log(
		`done mode=${args.apply ? "apply" : "dry-run"} replayed=${summary.replayed} byPath=${JSON.stringify(summary.byPath)} skipped=${JSON.stringify(summary.skipped)}`,
	);
	const poisoned = summary.skipped.poisoned ?? 0;
	if (poisoned > 0) {
		console.log(
			`WARNING: ${poisoned} poisoned journal row(s) were not replayed; inspect them on the source database.`,
		);
	}
	console.log(`last_sequence=${summary.lastSequence ?? "none"}`);
	await closeDb();
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(error instanceof Error ? error.message : error);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
