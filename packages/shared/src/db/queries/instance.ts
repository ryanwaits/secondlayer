import type { Kysely } from "kysely";
import type { Database } from "../types.ts";

export const INSTANCE_NETWORKS = ["mainnet", "testnet", "devnet"] as const;
export type InstanceNetwork = (typeof INSTANCE_NETWORKS)[number];

export type InstanceRow = {
	id: string;
	network: InstanceNetwork;
	created_at: Date;
};

export class InstanceNetworkMismatchError extends Error {
	readonly name = "InstanceNetworkMismatchError";
	constructor(
		readonly existing: InstanceNetwork,
		readonly requested: InstanceNetwork,
	) {
		super(`instance network is ${existing}; cannot change to ${requested}`);
	}
}

export class InvalidInstanceNetworkError extends Error {
	readonly name = "InvalidInstanceNetworkError";
	constructor(readonly value: string) {
		super(
			`instance network must be mainnet, testnet, or devnet (got ${value})`,
		);
	}
}

export function parseInstanceNetwork(value: string): InstanceNetwork {
	const network = value.trim().toLowerCase();
	if ((INSTANCE_NETWORKS as readonly string[]).includes(network)) {
		return network as InstanceNetwork;
	}
	throw new InvalidInstanceNetworkError(value);
}

/** STACKS_NETWORK, then NETWORK, then mainnet. */
export function instanceNetworkFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): InstanceNetwork {
	return parseInstanceNetwork(env.STACKS_NETWORK ?? env.NETWORK ?? "mainnet");
}

export async function getInstance(
	db: Kysely<Database>,
): Promise<InstanceRow | null> {
	const row = await db
		.selectFrom("instances")
		.select(["id", "network", "created_at"])
		.executeTakeFirst();
	return row ? toInstance(row) : null;
}

/**
 * Return the singleton instance, creating it on first call.
 * A second call with a different network is refused — the network is
 * immutable for the life of the database.
 */
export async function ensureInstance(
	db: Kysely<Database>,
	input: { network: InstanceNetwork },
): Promise<InstanceRow> {
	const existing = await getInstance(db);
	if (existing) {
		if (existing.network !== input.network) {
			throw new InstanceNetworkMismatchError(existing.network, input.network);
		}
		return existing;
	}
	try {
		const inserted = await db
			.insertInto("instances")
			.values({ network: input.network })
			.returning(["id", "network", "created_at"])
			.executeTakeFirstOrThrow();
		return toInstance(inserted);
	} catch {
		// Lost the singleton race — the other writer won.
		const raced = await getInstance(db);
		if (!raced) throw new Error("failed to create instance");
		if (raced.network !== input.network) {
			throw new InstanceNetworkMismatchError(raced.network, input.network);
		}
		return raced;
	}
}

function toInstance(row: {
	id: string;
	network: string;
	created_at: Date;
}): InstanceRow {
	return {
		id: row.id,
		network: parseInstanceNetwork(row.network),
		created_at: row.created_at,
	};
}

/**
 * A stack with no local chain: it reads chain data from a hosted Index/Streams
 * API (`SUBGRAPH_INDEX_API_URL` set) and its own `index_progress` has no row
 * for this network (a hosted tenant). Derived, not configured: a self-hoster
 * running a local indexer has the row and keeps reading its own tables, even
 * with its processors pointed at its own api over HTTP.
 */
export async function hasNoLocalChain(
	db: Kysely<Database>,
	opts: {
		env?: NodeJS.ProcessEnv;
		hasProgressRow?: (network: string) => Promise<boolean>;
	} = {},
): Promise<boolean> {
	const env = opts.env ?? process.env;
	if (!env.SUBGRAPH_INDEX_API_URL) return false;
	const network = env.NETWORK ?? "mainnet";
	const hasRow =
		opts.hasProgressRow ?? ((n: string) => hasLocalProgressRow(db, n));
	return !(await hasRow(network));
}

async function hasLocalProgressRow(
	db: Kysely<Database>,
	network: string,
): Promise<boolean> {
	const row = await db
		.selectFrom("index_progress")
		.select("network")
		.where("network", "=", network)
		.executeTakeFirst()
		.catch(() => undefined);
	return row !== undefined;
}
