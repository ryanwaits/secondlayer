import { ApiError, apiRequest } from "@/lib/api";
import type { Account, ApiKey } from "@/lib/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	try {
		const { token } = await req.json();
		const data = await apiRequest<{ sessionToken: string; account: Account }>(
			"/api/auth/verify",
			{ method: "POST", body: { token } },
		);

		const { sessionToken, account } = data;

		// Check if user has existing keys; if not, auto-create first key
		let apiKey: string | undefined;
		try {
			const keys = await apiRequest<ApiKey[]>("/api/keys", {
				sessionToken,
			});
			if (keys.length === 0) {
				const newKey = await apiRequest<{ key: string }>("/api/keys", {
					method: "POST",
					body: { name: "Default" },
					sessionToken,
				});
				apiKey = newKey.key;
			}
		} catch {
			// Non-critical — user can create keys later
		}

		const isProduction = process.env.NODE_ENV === "production";
		const cookie = [
			`sl_session=${sessionToken}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Lax",
			"Max-Age=7776000",
			...(isProduction ? ["Secure"] : []),
		].join("; ");

		const res = NextResponse.json({ account, apiKey });
		res.headers.set("Set-Cookie", cookie);
		return res;
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
