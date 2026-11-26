const INGEST_HOST = "https://us.i.posthog.com";
const ASSETS_HOST = "https://us-assets.i.posthog.com";
const INGEST_PREFIX = "/ingest/";
const STATIC_PREFIX = "static/";

const FORWARDED_HEADERS = [
	"content-type",
	"content-encoding",
	"accept",
	"accept-language",
	"user-agent",
	"x-forwarded-for",
	"origin",
	"referer",
];

export function ingestUpstreamUrl(pathname: string, search: string): string {
	if (!pathname.startsWith(INGEST_PREFIX)) {
		throw new Error("not an ingest path");
	}
	const rest = pathname.slice(INGEST_PREFIX.length);
	if (rest.split("/").some((segment) => segment === "..")) {
		throw new Error("invalid ingest path");
	}
	if (rest.startsWith(STATIC_PREFIX)) {
		return `${ASSETS_HOST}/${rest}${search}`;
	}
	return `${INGEST_HOST}/${rest}${search}`;
}

export function ingestRequestHeaders(incoming: Headers): Headers {
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = incoming.get(name);
		if (value !== null) headers.set(name, value);
	}
	return headers;
}

const DROPPED_RESPONSE_HEADERS = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"set-cookie",
];

export function ingestResponseHeaders(upstream: Headers): Headers {
	const headers = new Headers(upstream);
	for (const name of DROPPED_RESPONSE_HEADERS) headers.delete(name);
	return headers;
}
