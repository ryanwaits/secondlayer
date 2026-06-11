import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const PLATFORM_API_URL =
	process.env.SL_API_URL || "http://localhost:3800";
const API_URL = PLATFORM_API_URL;

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
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
	const { method = "GET", body, sessionToken, tags } = options;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...options.headers,
	};

	if (sessionToken) {
		headers.Authorization = `Bearer ${sessionToken}`;
	}

	const nextOptions: Record<string, unknown> = tags
		? { tags, revalidate: 10 }
		: { revalidate: 0 };

	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
		next: nextOptions,
	});

	if (!res.ok) {
		const text = await res.text();
		let message = text;
		try {
			const json = JSON.parse(text);
			message = json.message || json.error || text;
		} catch {}
		throw new ApiError(res.status, message);
	}

	return res.json() as Promise<T>;
}

/**
 * Thin Next route helper: validates the cookie session, forwards to the
 * platform API as a Bearer call, optionally revalidates a cache tag on
 * success, and maps ApiError to a JSON response with the right status.
 */
export async function proxyApiRequest<T>(
	req: Request,
	path: string,
	options: {
		method?: string;
		body?: unknown;
		query?: URLSearchParams;
		headers?: Record<string, string>;
		revalidate?: string | string[];
	} = {},
): Promise<NextResponse> {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const qs = options.query ? `?${options.query.toString()}` : "";
	try {
		const data = await apiRequest<T>(`${path}${qs}`, {
			method: options.method,
			body: options.body,
			headers: options.headers,
			sessionToken,
		});
		if (options.revalidate) {
			const tags = Array.isArray(options.revalidate)
				? options.revalidate
				: [options.revalidate];
			for (const tag of tags) revalidateTag(tag, { expire: 0 });
		}
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

export function getSessionFromRequest(req: Request): string | null {
	const cookie = req.headers.get("cookie");
	if (!cookie) return null;
	const match = cookie.match(/sl_session=([^;]+)/);
	return match ? match[1] : null;
}

export async function getSessionFromCookies(): Promise<string | null> {
	const cookieStore = await cookies();
	return cookieStore.get("sl_session")?.value ?? null;
}
