import type { Account } from "./types";

/**
 * Whether the browser has a session. `unreachable` is its own state: a
 * network error or a 5xx from `/api/auth/me` says nothing about the session,
 * so it must never read as signed out (that would send a CLI or OAuth
 * approval to /signin on a dropped connection).
 */
export type Session =
	| { kind: "unknown" }
	| { kind: "signedIn"; account: Account }
	| { kind: "signedOut" }
	| { kind: "unreachable" };

export type SessionEvent =
	/** `/api/auth/me` answered (any status) with this parsed body, or none. */
	| { type: "answered"; status: number; body: unknown }
	/** `/api/auth/me` could not be read at all. */
	| { type: "unreachable" }
	| { type: "signedIn"; account: Account }
	| { type: "signedOut" };

export const SESSION_UNKNOWN: Session = { kind: "unknown" };

/** What an `/api/auth/me` answer means. Only an explicit signed-out answer
 *  (a 401, or a 200 with no account) is signed out. */
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
