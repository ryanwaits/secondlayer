import { PUBLIC_API_URL } from "@/lib/public-api";

export async function postUpdatesToken(
	path: "unsubscribe" | "resubscribe",
	token: string,
): Promise<string | null> {
	const res = await fetch(`${PUBLIC_API_URL}/api/public/updates/${path}`, {
		method: "POST",
		credentials: "omit",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token }),
	});
	const body = (await res.json().catch(() => null)) as {
		email?: string;
	} | null;
	return res.ok && body?.email ? body.email : null;
}

export type UpdatesMemory =
	| { status: "pending"; email: string }
	| { status: "confirmed"; email: string; token: string };

const KEY = "sl-updates";

export function readUpdatesMemory(): UpdatesMemory | null {
	try {
		const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
		if (typeof value?.email !== "string") return null;
		if (value.status === "pending") {
			return { status: "pending", email: value.email };
		}
		if (value.status === "confirmed" && typeof value.token === "string") {
			return { status: "confirmed", email: value.email, token: value.token };
		}
		return null;
	} catch {
		return null;
	}
}

export function rememberUpdates(memory: UpdatesMemory): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(memory));
	} catch {}
}

export function forgetUpdates(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {}
}
