import type { Account } from "./types";

/**
 * `unreachable` is its own state: a network error or a 5xx from `/api/auth/me`
 * says nothing about the session, so it must never read as signed out (that
 * would send a CLI or OAuth approval to /signin on a dropped connection).
 */
export type Session =
	| { kind: "unknown" }
	| { kind: "signedIn"; account: Account }
	| { kind: "signedOut" }
	| { kind: "unreachable" };

export type SessionEvent =
	| { type: "answered"; status: number; body: unknown }
	| { type: "unreachable" }
	| { type: "signedIn"; account: Account }
	| { type: "signedOut" };

export const SESSION_UNKNOWN: Session = { kind: "unknown" };

export function sessionFromMe(status: number, body: unknown): Session {
	if (status === 401) return { kind: "signedOut" };
	if (status >= 200 && status < 300 && body && typeof body === "object") {
		const account = (body as { account?: unknown }).account;
		if (account && typeof account === "object") {
			return { kind: "signedIn", account: account as Account };
		}
		if (account === null) return { kind: "signedOut" };
	}
	return { kind: "unreachable" };
}

export function sessionReducer(state: Session, event: SessionEvent): Session {
	switch (event.type) {
		case "signedIn":
			return { kind: "signedIn", account: event.account };
		case "signedOut":
			return { kind: "signedOut" };
		case "unreachable":
			// A failed re-check doesn't sign anyone out.
			return state.kind === "signedIn" ? state : { kind: "unreachable" };
		case "answered": {
			const next = sessionFromMe(event.status, event.body);
			return next.kind === "unreachable"
				? sessionReducer(state, { type: "unreachable" })
				: next;
		}
	}
}

export function accountOf(session: Session): Account | null {
	return session.kind === "signedIn" ? session.account : null;
}

export const SESSION_CHANNEL = "sl-session";

export type SessionSignal = { accountId: string | null };

export function sessionSignal(account: Account | null): SessionSignal {
	return { accountId: account?.id ?? null };
}

export function signalStalesSession(data: unknown, session: Session): boolean {
	if (!data || typeof data !== "object" || !("accountId" in data)) return false;
	const { accountId } = data as { accountId: unknown };
	if (accountId !== null && typeof accountId !== "string") return false;
	return accountId !== (accountOf(session)?.id ?? null);
}

export function accountSwitched(session: Session, next: Account): boolean {
	return session.kind === "signedIn" && session.account.id !== next.id;
}
