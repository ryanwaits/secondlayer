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

function resolveUrl(opts?: ListenOptions): string {
	const url = opts?.connectionString ?? process.env.DATABASE_URL;
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
