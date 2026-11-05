/**
 * TLS options for a postgres.js client, as a spread-able object.
 *
 * An explicit `sslmode` (or `ssl`) in the URL wins: we return no `ssl` key at
 * all, because postgres.js reads the URL only when the option is absent — even
 * `ssl: undefined` would mask it. Otherwise local hosts skip TLS (any Docker
 * service alias is a single-label hostname on an internal network) and every
 * other host requires it.
 */
export function tlsOptions(url: string): {
	ssl?: { rejectUnauthorized: boolean };
} {
	let parsed: URL | null = null;
	try {
		parsed = new URL(url);
	} catch {}
	if (parsed?.searchParams.has("sslmode") || parsed?.searchParams.has("ssl")) {
		return {};
	}
	const host = parsed?.hostname ?? "";
	const isLocal =
		host === "localhost" || host === "127.0.0.1" || !host.includes(".");
	if (isLocal) return {};
	return {
		ssl: {
			rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
		},
	};
}
