import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export function connectDb(url: string): {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	db: Kysely<any>;
	close: () => Promise<void>;
} {
	const isLocal =
		url.includes("localhost") ||
		url.includes("127.0.0.1") ||
		url.includes("@postgres:");
	const client = postgres(url, {
		ssl: isLocal
			? undefined
			: {
					rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
				},
	});

	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const db = new Kysely<any>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});

	return {
		db,
		async close() {
			await db.destroy();
			await client.end();
		},
	};
}
