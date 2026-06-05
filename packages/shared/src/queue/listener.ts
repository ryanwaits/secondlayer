import postgres from "postgres";

interface ListenOptions {
	/**
	 * Connection string to LISTEN on. Defaults to `process.env.DATABASE_URL`.
	 * In dual-DB mode, pass `SOURCE_DATABASE_URL` for indexer-fired channels
	 * (`indexer:new_block`, `subgraph_reorg`, `tx:confirmed`) and
	 * `TARGET_DATABASE_URL` for tenant-local channels (`subgraph_changes`).
	 */
	connectionString?: string;
}

/**
 * LISTEN/NOTIFY connection for indexer-fired channels (`indexer:new_block`,
 * `subgraph_reorg`, `tx:confirmed`) — they fire on the SOURCE (chain) DB.
 * `||` (not `??`) so an empty-string env (an unset `SOURCE_DATABASE_URL` passed
 * through docker-compose as `""`) falls back to `DATABASE_URL`.
 */
export function sourceListenerUrl(): string | undefined {
	return process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
}

/**
 * LISTEN/NOTIFY connection for control-plane channels (`subscriptions:new_outbox`,
 * `subscriptions:changed`, subgraph operations) — they fire on the TARGET DB.
 */
export function targetListenerUrl(): string | undefined {
	return process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
}

function resolveUrl(opts?: ListenOptions): string {
	// `||` not `??`: an empty-string connectionString (e.g. an unset
	// SOURCE_/TARGET_DATABASE_URL passed through docker-compose as "") must fall
	// back to DATABASE_URL, not be treated as a valid value.
	const url = opts?.connectionString || process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"listen/notify requires a connection string (opts.connectionString or DATABASE_URL)",
		);
	}
	return url;
}

export async function listen(
	channel: string,
	callback: (payload?: string) => void,
	opts?: ListenOptions,
): Promise<() => Promise<void>> {
	const client = postgres(resolveUrl(opts), {
		max: 1,
		onnotice: () => {},
	});

	await client.listen(channel, (payload) => {
		callback(payload);
	});

	return async () => {
		await client.end();
	};
}

export async function notify(
	channel: string,
	payload?: string,
	opts?: ListenOptions,
): Promise<void> {
	const client = postgres(resolveUrl(opts), { max: 1 });

	try {
		if (payload) {
			await client`SELECT pg_notify(${channel}, ${payload})`;
		} else {
			await client`SELECT pg_notify(${channel}, '')`;
		}
	} finally {
		await client.end();
	}
}
