import { type Kysely, sql } from "kysely";

/**
 * The one convention for state machines: states are a const array (mirrored by
 * a DB CHECK), transitions are a table next to the states, and every status
 * write goes through `casTransition`.
 */

export interface Machine<S extends string> {
	readonly states: readonly S[];
	canTransition(from: S, to: S): boolean;
	/** Throws on an illegal move. */
	assert(from: S, to: S): void;
}

/** Pure transition table. `transitions` lists, per state, the states it may move to. */
export function defineMachine<const S extends string>(def: {
	states: readonly S[];
	transitions: { readonly [K in S]?: readonly S[] };
}): Machine<S> {
	const canTransition = (from: S, to: S) =>
		def.transitions[from]?.includes(to) ?? false;
	return {
		states: def.states,
		canTransition,
		assert(from, to) {
			if (!canTransition(from, to)) {
				throw new Error(`illegal transition ${from} -> ${to}`);
			}
		},
	};
}

export interface CasTransition<S extends string> {
	table: string;
	/** Value of the row key. */
	id: string | number;
	/** Row key column, `id` unless the table is addressed by another unique column (`name`). */
	key?: string;
	/** Status column, `status` unless the machine lives in another column. */
	column?: string;
	/** The row moves only if it is currently in one of these states. */
	from: readonly S[];
	to: S;
	/** Extra columns written in the same statement. Wrap jsonb values with `jsonb()`. */
	set?: Record<string, unknown>;
	/** Stamp `updated_at = now()`. Pass `false` for tables without that column. */
	stampUpdatedAt?: boolean;
}

/**
 * Compare-and-swap a status column: `UPDATE ... WHERE key = ? AND column = ANY(from)`.
 * Returns the updated row, or `null` when the row was missing or not in a `from`
 * state (a lost race). The caller decides what `null` means; usually log and stop.
 * Works with `db` and inside a transaction (`trx`).
 */
export async function casTransition<
	S extends string,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic table name, row shape is the caller's
	Row = Record<string, any>,
>(
	// biome-ignore lint/suspicious/noExplicitAny: accepts Kysely<Database> and Transaction<Database>
	db: Kysely<any>,
	t: CasTransition<S>,
): Promise<Row | null> {
	const column = sql.id(t.column ?? "status");
	const assignments = [sql`${column} = ${t.to}`];
	if (t.stampUpdatedAt !== false) assignments.push(sql`updated_at = now()`);
	for (const [key, value] of Object.entries(t.set ?? {})) {
		assignments.push(sql`${sql.id(key)} = ${value}`);
	}

	const { rows } = await sql<Row>`
		UPDATE ${sql.table(t.table)}
		SET ${sql.join(assignments)}
		WHERE ${sql.id(t.key ?? "id")} = ${t.id} AND ${column} = ANY(${sql.val([...t.from])})
		RETURNING *
	`.execute(db);
	return rows[0] ?? null;
}
