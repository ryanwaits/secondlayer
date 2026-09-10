import {
	SecondLayer,
	resolveAccountKey,
	resolveApiKey,
} from "@secondlayer/sdk";

let instance: SecondLayer | null = null;

/** Hosted archive ops (credits/quote/latest). Never INSTANCE_TOKEN. */
export const HOSTED_KEY_HINT =
	"set SECONDLAYER_API_KEY (sk-sl_*) for credits; INSTANCE_TOKEN is the instance";

const DEFAULT_ARCHIVE_OPS_URL = "https://api.secondlayer.tools";

/**
 * Read the instance credential from env: `INSTANCE_TOKEN` only. Does not read
 * `SL_API_KEY` / `SECONDLAYER_API_KEY` (those are the hosted account key).
 * Delegated to the SDK so the MCP server, CLI, and SDK resolve identically.
 */
export function readApiKey(): string | undefined {
	return resolveApiKey();
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
		const baseUrl =
			process.env.SECONDLAYER_API_URL ||
			process.env.SL_API_URL ||
			"http://127.0.0.1:3800";
		const dumpsBaseUrl = process.env.SL_STREAMS_DUMPS_URL;
		instance = new SecondLayer({
			...(apiKey ? { apiKey } : {}),
			origin: "mcp",
			baseUrl,
			...(dumpsBaseUrl ? { dumpsBaseUrl } : {}),
		});
	}
	return instance;
}

/** `sk-sl_*` for api.secondlayer.tools. Empty/unset is missing — never fall
 *  back to INSTANCE_TOKEN. Prefers SECONDLAYER_API_KEY, then SL_API_KEY /
 *  SL_ARCHIVE_API_KEY (one-release fallbacks via the SDK helper). */
export function readArchiveApiKey(): string | undefined {
	return resolveAccountKey();
}

/**
 * Separate client for hosted archive ops. `archiveOpsUrl` defaults to
 * `https://api.secondlayer.tools`. Bearer is the hosted account key.
 */
export function getArchiveOpsClient(): SecondLayer {
	const accountKey = readArchiveApiKey();
	if (!accountKey) {
		throw new Error(HOSTED_KEY_HINT);
	}
	const archiveOpsUrl =
		process.env.SL_CREDITS_API_URL ||
		process.env.ARCHIVE_OPS_API_URL ||
		DEFAULT_ARCHIVE_OPS_URL;
	return new SecondLayer({
		accountKey,
		origin: "mcp",
		archiveOpsUrl,
	});
}

// Appended to 401/403 errors raised on keyless requests — the operation needs
// a write/account key, so point at where to get one.
export const keyHint = " — set INSTANCE_TOKEN from `sl init` for writes";

/** Raw fetch helper for API endpoints not covered by the SDK. */
export async function apiRequest<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const baseUrl =
		process.env.SECONDLAYER_API_URL ||
		process.env.SL_API_URL ||
		"http://127.0.0.1:3800";
	let host = "";
	try {
		host = new URL(baseUrl).hostname;
	} catch {
		host = "";
	}
	const apiKey =
		host === "api.secondlayer.tools" ? resolveAccountKey() : readApiKey();
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
