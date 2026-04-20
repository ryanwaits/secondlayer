import { SecondLayer } from "@secondlayer/sdk";

let instance: SecondLayer | null = null;
let legacyEnvWarned = false;

/**
 * Read the tenant service key from env. `SL_SERVICE_KEY` is canonical;
 * `SECONDLAYER_API_KEY` is accepted as a deprecated alias and logs once
 * per process so users notice without breaking their setup.
 */
function readServiceKey(): string | undefined {
	const canonical = process.env.SL_SERVICE_KEY;
	if (canonical) return canonical;
	const legacy = process.env.SECONDLAYER_API_KEY;
	if (legacy) {
		if (!legacyEnvWarned) {
			legacyEnvWarned = true;
			console.error(
				"[mcp] SECONDLAYER_API_KEY is deprecated — use SL_SERVICE_KEY going forward.",
			);
		}
		return legacy;
	}
	return undefined;
}

/** Lazy SDK singleton from SL_SERVICE_KEY (or SECONDLAYER_API_KEY) env var. */
export function getClient(): SecondLayer {
	if (!instance) {
		const apiKey = readServiceKey();
		if (!apiKey) {
			throw new Error(
				"SL_SERVICE_KEY environment variable is required. " +
					"Get your key from `sl instance info` or the dashboard.",
			);
		}
		const baseUrl = process.env.SECONDLAYER_API_URL;
		instance = new SecondLayer({
			apiKey,
			origin: "mcp",
			...(baseUrl ? { baseUrl } : {}),
		});
	}
	return instance;
}

/** Raw fetch helper for API endpoints not covered by the SDK. */
export async function apiRequest<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const apiKey = readServiceKey();
	if (!apiKey) throw new Error("SL_SERVICE_KEY required");
	const baseUrl =
		process.env.SECONDLAYER_API_URL || "https://api.secondlayer.tools";
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw Object.assign(new Error(text || `HTTP ${res.status}`), {
			status: res.status,
		});
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}
