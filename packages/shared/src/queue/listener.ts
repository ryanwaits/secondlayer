import postgres from "postgres";

export async function listen(
	channel: string,
	callback: (payload?: string) => void,
): Promise<() => Promise<void>> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}

	const client = postgres(connectionString, {
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

export async function notify(channel: string, payload?: string): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}

	const client = postgres(connectionString, { max: 1 });

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
