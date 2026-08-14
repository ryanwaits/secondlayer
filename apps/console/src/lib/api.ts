/**
 * Server-side client for the operator's Secondlayer instance.
 *
 * The console container talks to the runtime over the compose network
 * (`SL_API_URL`, default `http://secondlayer:3800`); in dev it falls back to
 * loopback. Auth is the single `INSTANCE_TOKEN` — no sessions, no accounts.
 * Loopback instances accept requests without a token, so the header is only
 * attached when a token is configured.
 */

export const INSTANCE_API_URL =
	process.env.SL_API_URL || "http://127.0.0.1:3800";

const INSTANCE_TOKEN = process.env.INSTANCE_TOKEN || "";

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * Rejects a request path that could resolve outside the intended upstream
 * route: a segment that decodes to ".", "..", or contains a "/" can pop or
 * widen path segments once the WHATWG URL parser resolves it.
 */
export function assertSafePath(path: string): void {
	const pathname = path.split("?")[0] ?? "";
	for (const segment of pathname.split("/")) {
		if (!segment) continue;
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			throw new ApiError(400, "Invalid request path");
		}
		if (decoded === "." || decoded === ".." || decoded.includes("/")) {
			throw new ApiError(400, "Invalid request path");
		}
	}
}

export async function apiRequest<T>(
	path: string,
	init?: { method?: string; body?: unknown; cache?: RequestCache },
): Promise<T> {
	assertSafePath(path);
	const headers: Record<string, string> = {};
	if (INSTANCE_TOKEN) headers.Authorization = `Bearer ${INSTANCE_TOKEN}`;
	if (init?.body !== undefined) headers["Content-Type"] = "application/json";

	const res = await fetch(`${INSTANCE_API_URL}${path}`, {
		method: init?.method ?? "GET",
		headers,
		body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
		cache: init?.cache ?? "no-store",
	});
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			const data = (await res.json()) as { error?: string };
			if (data.error) message = data.error;
		} catch {
			// non-JSON error body; keep the status line
		}
		throw new ApiError(res.status, message);
	}
	return (await res.json()) as T;
}
