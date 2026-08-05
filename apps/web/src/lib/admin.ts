import { NextResponse } from "next/server";
import { ApiError, apiRequest, getSessionFromRequest } from "./api";
import type { Account } from "./types";

const ADMIN_EMAILS = ["ryan.waits@gmail.com"];

export function isAdmin(email: string): boolean {
	return ADMIN_EMAILS.includes(email);
}

export type AdminCheck =
	| { ok: true; sessionToken: string }
	| { ok: false; response: NextResponse };

/**
 * Fail-closed guard for /api/admin/* route handlers. Upstream already
 * enforces admin on these paths, but that's the platform API's job, not a
 * reason for the BFF to skip its own check — a route here should not depend
 * on every future caller remembering upstream is the real gate. Resolves
 * the caller's session to an account and checks it against the same
 * allowlist the admin page tree uses, so the rule lives in one place.
 */
export async function requireAdmin(req: Request): Promise<AdminCheck> {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return {
			ok: false,
			response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
		};
	}

	try {
		const account = await apiRequest<Account>("/api/accounts/me", {
			sessionToken,
		});
		if (!isAdmin(account.email)) {
			return {
				ok: false,
				response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
			};
		}
	} catch (e) {
		const message = e instanceof ApiError ? e.message : "Forbidden";
		return {
			ok: false,
			response: NextResponse.json({ error: message }, { status: 403 }),
		};
	}

	return { ok: true, sessionToken };
}
