import { SecondLayer } from "@secondlayer/sdk";

let instance: SecondLayer | null = null;

/** Lazy SDK singleton from SECONDLAYER_API_KEY env var. */
export function getClient(): SecondLayer {
	if (!instance) {
		const apiKey = process.env.SECONDLAYER_API_KEY;
		if (!apiKey) {
			throw new Error(
				"SECONDLAYER_API_KEY environment variable is required. " +
					"Get your key at https://app.secondlayer.tools/settings/api-keys",
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
	const apiKey = process.env.SECONDLAYER_API_KEY;
	if (!apiKey) throw new Error("SECONDLAYER_API_KEY required");
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
