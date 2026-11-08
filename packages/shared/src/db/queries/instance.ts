import type { Kysely } from "kysely";
import { logger } from "../../logger.ts";
import { keyMatchesCanary, sealKeyCanary } from "../../runtime/backup.ts";
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

let warnedNetworkFallback = false;

/**
 * The network key `index_progress` is written under: `STACKS_NETWORK`, else
 * the deprecated `NETWORK` (logged once so a deployment that only sets it is
 * not silently re-keyed), else mainnet. Not validated; see
 * {@link instanceNetworkFromEnv} for the strict form.
 */
export function stacksNetworkFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (env.STACKS_NETWORK) return env.STACKS_NETWORK;
	if (env.NETWORK) {
		if (!warnedNetworkFallback) {
			warnedNetworkFallback = true;
			logger.warn("NETWORK is deprecated: set STACKS_NETWORK instead");
		}
		return env.NETWORK;
	}
	return "mainnet";
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

export class SecretsKeyMismatchError extends Error {
	readonly name = "SecretsKeyMismatchError";
	constructor() {
		super(
			"SECONDLAYER_SECRETS_KEY is not the key this database's secrets were sealed with. Refusing to start: running on a different key leaves every webhook signing secret unreadable. Restore the original key (the DATA_DIR volume's secrets.env, or your SECONDLAYER_SECRETS_KEY), or clear instances.secrets_key_canary only if you mean to abandon those secrets.",
		);
	}
}

/**
 * Pin the secrets key to this database. The first boot with a key seals a
 * canary into the instance row; every later boot must open it with the key it
 * was handed, or it refuses to start. Without this, a lost key is replaced by
 * a freshly generated one and every encrypted column quietly stops decrypting.
 */
export async function ensureSecretsKeyCanary(
	db: Kysely<Database>,
	input: { keyHex: string; network: InstanceNetwork },
): Promise<void> {
	const read = () =>
		db
			.selectFrom("instances")
			.select(["id", "secrets_key_canary"])
			.executeTakeFirst();

	let row = await read();
	if (!row) {
		await db
			.insertInto("instances")
			.values({
				network: input.network,
				secrets_key_canary: sealKeyCanary(input.keyHex),
			})
			.onConflict((oc) => oc.doNothing())
			.execute();
		row = await read();
		if (!row) throw new Error("failed to create instance");
	}
	if (row.secrets_key_canary === null) {
		// Only the first writer's canary counts: a concurrent boot with another
		// key loses the race and is then checked against the winner's.
		await db
			.updateTable("instances")
			.set({ secrets_key_canary: sealKeyCanary(input.keyHex) })
			.where("id", "=", row.id)
			.where("secrets_key_canary", "is", null)
			.execute();
		row = await read();
	}
	if (
		!row?.secrets_key_canary ||
		!keyMatchesCanary(row.secrets_key_canary, input.keyHex)
	) {
		throw new SecretsKeyMismatchError();
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
	const network = stacksNetworkFromEnv(env);
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
