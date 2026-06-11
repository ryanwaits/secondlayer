import { SecondLayer, readX402Receipt, withX402 } from "@secondlayer/sdk";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

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
/**
 * When `X402_PRIVATE_KEY` is set (a Stacks key holding an accepted token),
 * wrap fetch so 402 challenges on paid surfaces are paid automatically —
 * sponsored transfers, so the wallet never needs STX for gas. Each paid
 * call logs its settlement receipt to stderr (stdio-transport safe).
 */
function buildFetchImpl(): typeof fetch | undefined {
	const key = process.env.X402_PRIVATE_KEY;
	if (!key) return undefined;
	const account = privateKeyToAccount(key);
	// Optional treasury policy: deposit X402_TOPUP_USD whenever the prepaid
	// tab drops below X402_TOPUP_WHEN_BELOW (defaults $0.50). Without it,
	// every paid call settles individually.
	const topUpUsd = Number(process.env.X402_TOPUP_USD ?? "");
	const paid = withX402(fetch, {
		account,
		...(Number.isFinite(topUpUsd) && topUpUsd > 0
			? {
					topUp: {
						usd: topUpUsd,
						whenBelow: Number(process.env.X402_TOPUP_WHEN_BELOW ?? "0.5"),
					},
				}
			: {}),
	});
	const wrapped = async (input: string | URL, init?: RequestInit) => {
		const res = await paid(input, init);
		const receipt = readX402Receipt(res);
		if (receipt) {
			console.error(
				`[x402] paid call settled tier=${receipt.state ?? "confirmed"} txid=${receipt.txid}`,
			);
		}
		return res;
	};
	// SecondLayer only ever calls fetchImpl(url, init); Bun's `typeof fetch`
	// additionally carries `preconnect`, hence the cast.
	return wrapped as unknown as typeof fetch;
}

export function getClient(): SecondLayer {
	if (!instance) {
		const apiKey = readApiKey();
		const baseUrl = process.env.SECONDLAYER_API_URL;
		const dumpsBaseUrl = process.env.SL_STREAMS_DUMPS_URL;
		const fetchImpl = buildFetchImpl();
		instance = new SecondLayer({
			...(apiKey ? { apiKey } : {}),
			origin: "mcp",
			...(baseUrl ? { baseUrl } : {}),
			...(dumpsBaseUrl ? { dumpsBaseUrl } : {}),
			...(fetchImpl ? { fetchImpl } : {}),
		});
	}
	return instance;
}

// Appended to 401/403 errors raised on keyless requests — the operation needs
// a write/account key, so point at where to get one.
export const keyHint =
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
