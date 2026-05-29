import { SecondLayer } from "@secondlayer/sdk";

let instance: SecondLayer | null = null;

/**
 * Read the API key from env. `SL_API_KEY` is the single credential var, matching
 * the CLI and SDK. (The former `SL_SERVICE_KEY` / `SECONDLAYER_API_KEY` aliases
 * were removed.)
 */
function readApiKey(): string | undefined {
	return process.env.SL_API_KEY;
}

/**
 * Lazy SDK singleton. Built keyless when no key is set so read tools (list,
 * get, query, spec) work during open beta — reads are public. Write tools
 * (deploy/reindex/delete) and account tools hit the API without a key and get
 * a 401, surfaced with a key hint via `keyHint` below.
 */
export function getClient(): SecondLayer {
	if (!instance) {
		const apiKey = readApiKey();
		const baseUrl = process.env.SECONDLAYER_API_URL;
		instance = new SecondLayer({
			...(apiKey ? { apiKey } : {}),
			origin: "mcp",
			...(baseUrl ? { baseUrl } : {}),
		});
	}
	return instance;
}

// Appended to 401/403 errors raised on keyless requests — the operation needs
// a write/account key, so point at where to get one.
const keyHint =
	" — set SL_API_KEY to an sk-sl_ API key from " +
	"https://secondlayer.tools/platform/api-keys for write and account operations";

/** Raw fetch helper for API endpoints not covered by the SDK. */
export async function apiRequest<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const apiKey = readApiKey();
	const baseUrl =
		process.env.SECONDLAYER_API_URL || "https://api.secondlayer.tools";
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		const needsKey = !apiKey && (res.status === 401 || res.status === 403);
		throw Object.assign(
			new Error((text || `HTTP ${res.status}`) + (needsKey ? keyHint : "")),
			{ status: res.status },
		);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}
