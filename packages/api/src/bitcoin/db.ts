/**
 * Bitcoin/Runes data-plane access for the `/v1/index/runes/*` read surface
 * (plan 058). A separate Postgres from the Stacks source DB (D18,
 * `docs/internal/bitcoin-runtime.md`) — `packages/bitcoin` owns the schema
 * and ingest (`packages/bitcoin/src/db/store.ts`), this file only reads it.
 *
 * `BITCOIN_DATABASE_URL` unset is a normal, supported state — Runes simply
 * isn't provisioned on this instance — not an error. Every reader here
 * degrades to the soft-flag pattern the rest of Index already uses
 * (`../index/pox5-events.ts`'s `POX5_DISABLED_NOTE`): an empty tip, an empty
 * `readBtcReorgs`, and `../index/runes.ts`'s response builders attach the
 * `notes` field instead of calling a reader that has no DB to read.
 */
import type { Database as BitcoinDatabase } from "@secondlayer/bitcoin/db";
import { CHECKPOINT_NAME } from "@secondlayer/bitcoin/db";
import { spacedRuneFromString } from "@secondlayer/bitcoin/rune";
import { ValidationError } from "@secondlayer/shared/errors";
import { type Driver, Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export function isBitcoinConfigured(): boolean {
	return !!process.env.BITCOIN_DATABASE_URL;
}

/**
 * Two Postgres codes that both mean "`BITCOIN_DATABASE_URL` is set, but
 * `packages/bitcoin`'s schema isn't there to read yet" (plan 062):
 *   - `42P01` (`undefined_table`) — the database exists, but its migrations
 *     haven't run (the oss compose profile always sets this env var on the
 *     `secondlayer` service once the `bitcoin` database exists, even when
 *     the `bitcoin` profile — the service that runs `migrate` — isn't
 *     enabled).
 *   - `3D000` (`invalid_catalog_name`) — the database itself doesn't exist
 *     yet (round 1: an *existing* oss install that pulls this update has no
 *     `bitcoin` database at all — the postgres init script that creates it
 *     only runs on a brand-new volume; `packages/bitcoin`'s own `migrate`
 *     self-provisions it going forward, but a reader here can still race
 *     that first migrate on a freshly-upgraded instance).
 * `isBitcoinConfigured()` only checks that the env var is set, not that the
 * database/schema exist; every DB-touching reader below also treats both
 * codes as "not configured" rather than a 500, same as the
 * `../index/pox5-events.ts` soft-flag pattern the rest of this file follows.
 * Same `.code` check shape as
 * `packages/shared/src/db/queries/subgraph-operations.ts`'s `"23505"` check.
 */
function isBitcoinSchemaAbsent(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const code = (err as Error & { code?: string }).code;
	return code === "42P01" || code === "3D000";
}

/**
 * `BITCOIN_DATABASE_URL` is set but its Postgres can't be reached (host
 * unresolvable, refused, timed out, restarting). A 503 with a name the caller
 * can retry on, not an opaque 500 — and not the "not configured" `notes`,
 * which would tell a consumer the data is empty rather than temporarily out
 * of reach. 2026-10-22..28 this was a 500 on every Runes and `chain=bitcoin`
 * Streams read.
 */
export class BitcoinDataUnavailableError extends Error {
	readonly code = "BITCOIN_DATA_UNAVAILABLE";
	constructor(cause: unknown) {
		super("Bitcoin data is temporarily unavailable. Retry shortly.", {
			cause,
		});
		this.name = "BitcoinDataUnavailableError";
	}
}

/** Connection-level failures from postgres.js / Bun's socket layer. Query
 *  errors (bad SQL, missing table) keep their own codes. `57P03` =
 *  cannot_connect_now (server starting up). */
const UNREACHABLE_CODES = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ETIMEDOUT",
	"CONNECT_TIMEOUT",
	"CONNECTION_CLOSED",
	"CONNECTION_ENDED",
	"CONNECTION_DESTROYED",
	"57P03",
]);

function isBitcoinDbUnreachable(err: unknown): boolean {
	const code = (err as { code?: unknown } | null)?.code;
	return typeof code === "string" && UNREACHABLE_CODES.has(code);
}

/** How long to answer 503 without trying to connect after a connect failed.
 *  Longer than the 5s connect timeout, so a sustained outage costs one slow
 *  probe per window per replica instead of a slow request every few. */
const BREAKER_OPEN_MS = 10_000;

/**
 * Connect circuit breaker. After an unreachable failure, `acquire` rejects
 * immediately with `BitcoinDataUnavailableError` for `BREAKER_OPEN_MS`.
 * After that ONE call probes with a real connect while every other call keeps
 * failing fast; the probe closes the breaker on success or re-opens it on
 * failure. Without it every read during an outage waited out the connect
 * timeout and queued behind the pool (2026-10-28 forced test). Other errors
 * pass through untouched. `now` is injectable for tests.
 */
export function connectBreaker<T>(
	acquire: () => Promise<T>,
	now: () => number = Date.now,
): () => Promise<T> {
	let openUntil = 0;
	let probing = false;
	let lastFailure: unknown;
	return async () => {
		const tripped = openUntil > 0;
		if (tripped && (now() < openUntil || probing)) {
			throw new BitcoinDataUnavailableError(lastFailure);
		}
		probing = tripped;
		try {
			const connection = await acquire();
			openUntil = 0;
			return connection;
		} catch (err) {
			if (!isBitcoinDbUnreachable(err)) throw err;
			lastFailure = err;
			openUntil = now() + BREAKER_OPEN_MS;
			throw new BitcoinDataUnavailableError(err);
		} finally {
			if (tripped) probing = false;
		}
	};
}

/** postgres.js connects inside `reserve()`, which Kysely calls to acquire a
 *  connection, so every reader's connect failure passes through here once. */
class BitcoinDialect extends PostgresJSDialect {
	override createDriver(): Driver {
		const driver = super.createDriver();
		driver.acquireConnection = connectBreaker(
			driver.acquireConnection.bind(driver),
		);
		return driver;
	}
}

const CONNECT_TIMEOUT_SECONDS = 5;

let bitcoinDb: Kysely<BitcoinDatabase> | undefined;
let bitcoinDbResolved = false;

/**
 * Lazy singleton, resolved once from `BITCOIN_DATABASE_URL` — `undefined`
 * when it isn't set. Every reader in `../index/runes.ts` takes an optional
 * `db` override, so DB-backed tests point at a scratch database directly and
 * never touch this singleton.
 */
export function getBitcoinDb(): Kysely<BitcoinDatabase> | undefined {
	if (bitcoinDbResolved) return bitcoinDb;
	bitcoinDbResolved = true;
	const url = process.env.BITCOIN_DATABASE_URL;
	if (!url) return undefined;
	const maxRaw = Number(process.env.BITCOIN_DATABASE_POOL_MAX ?? 10);
	const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 10;
	// The bitcoin Postgres runs on this host; a connect that takes seconds is
	// an outage. postgres.js waits 30s by default, and while the bitcoin plane
	// was down (2026-10-28 forced test) every Runes read hung that long before
	// its 503: a stopped container's published port drops packets rather than
	// refusing them.
	const client = postgres(url, {
		max,
		connect_timeout: CONNECT_TIMEOUT_SECONDS,
	});
	bitcoinDb = new Kysely<BitcoinDatabase>({
		dialect: new BitcoinDialect({ postgres: client }),
	});
	return bitcoinDb;
}

/** Test-only: undo `getBitcoinDb`'s memoized "no URL" / client resolution so
 *  a later test that sets `BITCOIN_DATABASE_URL` gets a fresh read of it. */
export function _resetBitcoinDbForTests(): void {
	bitcoinDb = undefined;
	bitcoinDbResolved = false;
}

/** Bitcoin block height a Runes read was served against — a separate clock
 *  from the Stacks `IndexTip` (`../index/tip.ts`): Runes ingest tracks the
 *  Bitcoin chain, not Stacks blocks. */
export type BitcoinIndexTip = {
	block_height: number;
	finalized_height: number;
	lag_seconds: number;
};

/** Zero tip served when Runes has never checkpointed (fresh instance, or
 *  `BITCOIN_DATABASE_URL` unset). Never cached — real the moment a checkpoint
 *  exists. */
const EMPTY_BITCOIN_TIP: BitcoinIndexTip = {
	block_height: 0,
	finalized_height: 0,
	lag_seconds: 0,
};

/** Reorg-safety margin for `finalized_height`, matching `UNDO_DEPTH`
 *  (`@secondlayer/bitcoin`'s `src/runes/undo.ts`) — the ingest side keeps
 *  exactly this many blocks of undo journal ready to reverse, so a row at or
 *  below this depth is past what a live reorg has ever needed to unwind. */
const BITCOIN_FINALITY_CONFIRMATIONS = 6;

const TIP_CACHE_TTL_MS = 500;

let tipCache: { expiresAt: number; value: BitcoinIndexTip } | null = null;

export type BitcoinTipProvider = () => Promise<BitcoinIndexTip>;

/**
 * The Runes read surface's tip: the `runes_checkpoint` row's height (the
 * highest Bitcoin block Runes state has ingested), a `finalized_height`
 * `BITCOIN_FINALITY_CONFIRMATIONS` behind it, and how stale that checkpoint
 * is. 500ms cache — same TTL as `createIndexTipProvider`
 * (`../index/tip.ts`) — cheap enough to hit on every request, still bounds
 * the checkpoint read to once per burst.
 */
export async function getBitcoinTip(
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<BitcoinIndexTip> {
	const nowMs = Date.now();
	if (tipCache && nowMs < tipCache.expiresAt) return tipCache.value;
	if (!db) return EMPTY_BITCOIN_TIP;

	let row: { height: number; updated_at: Date } | undefined;
	try {
		row = await db
			.selectFrom("runes_checkpoint")
			.select(["height", "updated_at"])
			.where("name", "=", CHECKPOINT_NAME)
			.executeTakeFirst();
	} catch (err) {
		// Database or `runes_checkpoint` table doesn't exist yet — same as unconfigured.
		if (!isBitcoinSchemaAbsent(err)) throw err;
		row = undefined;
	}
	const value: BitcoinIndexTip = row
		? {
				block_height: row.height,
				finalized_height: Math.max(
					0,
					row.height - BITCOIN_FINALITY_CONFIRMATIONS,
				),
				lag_seconds: Math.max(
					0,
					Math.round((nowMs - row.updated_at.getTime()) / 1000),
				),
			}
		: EMPTY_BITCOIN_TIP;

	tipCache = { expiresAt: nowMs + TIP_CACHE_TTL_MS, value };
	return value;
}

/** Test-only: drop the tip cache between fixtures that reuse the same
 *  process (mirrors `_resetPox4EraCacheForTests`, `../index/pox-era.ts`). */
export function _resetBitcoinTipCacheForTests(): void {
	tipCache = null;
}

/** Same fields as `packages/bitcoin/src/db/types.ts`'s `BtcReorgsTable` —
 *  shaped like the Stacks `ChainReorgRecord`
 *  (`packages/shared/src/db/queries/chain-reorgs.ts`) in spirit (a fork the
 *  indexer rolled back), not field-for-field identical: a Bitcoin reorg has
 *  no Stacks-style event_index component, so its orphaned range is plain
 *  block heights. */
export type BtcReorg = {
	id: string;
	detected_at: string;
	fork_point_height: number;
	old_hash: string;
	new_hash: string;
	orphaned_from: number;
	orphaned_to: number;
	new_tip_height: number;
};

type BtcReorgRow = {
	id: string;
	detected_at: Date;
	fork_point_height: number;
	old_hash: string;
	new_hash: string;
	orphaned_from: number;
	orphaned_to: number;
	new_tip_height: number;
};

function normalizeBtcReorg(row: BtcReorgRow): BtcReorg {
	return {
		id: row.id,
		detected_at: row.detected_at.toISOString(),
		fork_point_height: row.fork_point_height,
		old_hash: row.old_hash,
		new_hash: row.new_hash,
		orphaned_from: row.orphaned_from,
		orphaned_to: row.orphaned_to,
		new_tip_height: row.new_tip_height,
	};
}

export type BtcReorgsReader = (
	fromHeight: number,
	toHeight: number,
) => Promise<BtcReorg[]>;

/**
 * Reorgs whose orphaned range overlaps `[fromHeight, toHeight]` — the same
 * overlap test `readChainReorgsForHeightRange`
 * (`packages/shared/src/db/queries/chain-reorgs.ts`) runs for Stacks,
 * simpler here because a Bitcoin reorg is block-level only (no event_index
 * tiebreak to carry).
 */
export async function readBtcReorgs(
	fromHeight: number,
	toHeight: number,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<BtcReorg[]> {
	if (!db) return [];
	try {
		const rows = await db
			.selectFrom("btc_reorgs")
			.selectAll()
			.where("orphaned_from", "<=", toHeight)
			.where("orphaned_to", ">=", fromHeight)
			.orderBy("detected_at", "asc")
			.execute();
		return rows.map(normalizeBtcReorg);
	} catch (err) {
		// Database or `btc_reorgs` table doesn't exist yet — same as unconfigured.
		if (!isBitcoinSchemaAbsent(err)) throw err;
		return [];
	}
}

/**
 * A `RuneRef` — the id/name union every `:rune` path param and `rune=` query
 * filter accepts (plan 058). `id` is the canonical `<block>:<tx>` text
 * primary key (`rune_entries.rune_id`); `rune` is the name's base-26 integer
 * encoding (`rune_entries.rune`) — `../index/runes.ts`'s readers resolve
 * either form to a `rune_id` before it reaches SQL.
 */
export type RuneRef = { id: string } | { rune: bigint };

const RUNE_ID_RE = /^(\d+):(\d+)$/;

/**
 * Parse a `:rune`/`rune=` value. Two forms:
 *   - an id, `<block>:<tx>` (e.g. `840000:3`) — re-encoded through `BigInt`
 *     (so a leading-zero id like `007:3` still matches the canonical
 *     `rune_id` key `entryToRow` writes) and returned as-is; a nonexistent
 *     id is not an error here, it just won't match any row.
 *   - a name, case- and spacer-insensitive: `•`, `.` and spaces are all
 *     ignored, so `DOG•GO•TO•THE•MOON`, `dog.go.to.the.moon` and
 *     `doggotothemoon` parse identically. Spaces fold to `.` before
 *     `spacedRuneFromString` (`@secondlayer/bitcoin/rune` — the ord grammar
 *     it ports only recognizes `.`/`•` as spacers); its `Rune.n` is the
 *     `rune_entries.rune` lookup key.
 * Anything else throws `ValidationError` (→ 400 `VALIDATION_ERROR`, with a
 * hint at both accepted forms).
 */
export function parseRuneRef(input: string): RuneRef {
	const trimmed = input.trim();
	const idMatch = RUNE_ID_RE.exec(trimmed);
	if (idMatch) {
		const block = BigInt(idMatch[1] as string);
		const tx = BigInt(idMatch[2] as string);
		return { id: `${block}:${tx}` };
	}
	const normalized = trimmed.toUpperCase().replace(/\s+/g, ".");
	try {
		const { rune } = spacedRuneFromString(normalized);
		return { rune: rune.n };
	} catch (err) {
		throw new ValidationError(
			`invalid rune reference: ${input} (expected an id like "840000:3" or a name like "DOG•GO•TO•THE•MOON")`,
			err,
		);
	}
}
