export const PLATFORM_API_URL =
	process.env.SECONDLAYER_API_URL ||
	(process.env.NODE_ENV === "production"
		? "https://api.secondlayer.tools"
		: "http://localhost:3800");
const API_URL = PLATFORM_API_URL;

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		/** Seconds from the upstream `Retry-After` header, when it sent one. */
		public retryAfter?: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * Rejects a request path that could resolve outside the intended upstream
 * route. `encodeURIComponent` does not escape "." — a raw or percent-encoded
 * ".." segment interpolated into a path still gets resolved by the WHATWG
 * URL parser `fetch` uses, popping preceding segments. A segment that
 * decodes to a "/" (a smuggled separator) is rejected for the same reason:
 * it can widen a single path segment into extra ones the route never
 * intended.
 */
function assertSafePath(path: string): void {
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
	options: {
		method?: string;
		body?: unknown;
		sessionToken?: string;
		tags?: string[];
		headers?: Record<string, string>;
	} = {},
): Promise<T> {
	assertSafePath(path);
	const { method = "GET", body, sessionToken, tags } = options;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...options.headers,
	};

	if (sessionToken) {
		headers.Authorization = `Bearer ${sessionToken}`;
	}

	// Why: Server-Timing showed `next: { revalidate: 0 }` fetches hit a ~+210 ms
	// cold connection mode that raw `cache: "no-store"` fetches did not.
	const cacheOptions: RequestInit & { next?: unknown } = tags
		? { next: { tags, revalidate: 10 } }
		: { cache: "no-store" };

	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
		...cacheOptions,
	});

	if (!res.ok) {
		const text = await res.text();
		let message = text;
		try {
			const json = JSON.parse(text);
			message = json.message || json.error || text;
		} catch {}
		const retryAfter = Number(res.headers.get("retry-after"));
		throw new ApiError(
			res.status,
			message,
			Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
		);
	}

	return res.json() as Promise<T>;
}

export function getSessionFromRequest(req: Request): string | null {
	const cookie = req.headers.get("cookie");
	if (!cookie) return null;
	const match = cookie.match(/sl_session=([^;]+)/);
	return match ? match[1] : null;
}
