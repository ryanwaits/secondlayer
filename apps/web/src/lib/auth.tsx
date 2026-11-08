"use client";

import { useRouter } from "next/navigation";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
import { clearAccountData } from "./account-data";
import { distinctId, identify, reset } from "./analytics";
import {
	SESSION_CHANNEL,
	SESSION_UNKNOWN,
	type Session,
	type SessionEvent,
	accountOf,
	accountSwitched,
	sessionReducer,
	sessionSignal,
	signalStalesSession,
} from "./auth-session";
import { VERIFY_TIMEOUT_MS } from "./signin-flow";
import type { Account } from "./types";
import { marketingUrl } from "./urls";

interface AuthCtx {
	account: Account | null;
	/** The session hasn't been read yet. */
	loading: boolean;
	/** The session couldn't be read (network or server error): not signed
	 *  out. Pages that would redirect a signed-out visitor offer `refresh`
	 *  as a retry instead. */
	unreachable: boolean;
	/** `from` names the form that asked, for the server's analytics event. */
	login(
		email: string,
		from?: SigninFrom,
	): Promise<{ token?: string; code?: string }>;
	verify(tokenOrCode: string, email?: string): Promise<{ account: Account }>;
	logout(): Promise<void>;
	refresh(): Promise<void>;
}

/** A verify that never got an answer (timeout or network): the code may be
 *  fine, so the visitor is told to try again rather than that it was wrong. */
export class VerifyUnreachableError extends Error {}

/** Which form asked for a sign-in link: the sign-in page, or the docs
 *  "Make a lasting key" panel. */
export type SigninFrom = "signin" | "lasting_key";

/** The person properties sent with `identify`. `$internal_or_test_user` is
 *  what PostHog's internal-and-test filter reads; it is sent only when the
 *  account payload carries `internal`. */
export function accountTraits(account: Account): Record<string, unknown> {
	return {
		email: account.email,
		...(account.displayName ? { name: account.displayName } : {}),
		...(typeof account.internal === "boolean"
			? { $internal_or_test_user: account.internal }
			: {}),
	};
}

function identifyAccount(account: Account) {
	identify(account.id, accountTraits(account));
}

const AuthContext = createContext<AuthCtx | null>(null);

type AuthState = { session: Session };

/** What the server render and the first hydration pass see: not yet known. */
const UNKNOWN: AuthState = { session: SESSION_UNKNOWN };

// A module store, so a page that already read the account on the server can
// hand it over before the provider's first effect. Browser-only writes: the
// module is shared across requests on the server.
let auth: AuthState = UNKNOWN;
const listeners = new Set<() => void>();

function dispatchSession(event: SessionEvent) {
	const session = sessionReducer(auth.session, event);
	if (session === auth.session) return;
	auth = { session };
	for (const l of listeners) l();
}

/** Tells the other tabs of this browser who is signed in now. */
function announceSession(account: Account | null): void {
	if (typeof BroadcastChannel === "undefined") return;
	try {
		const channel = new BroadcastChannel(SESSION_CHANNEL);
		channel.postMessage(sessionSignal(account));
		channel.close();
	} catch {
		// No channel: the other tabs find out on their next read.
	}
}

function subscribeAuth(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** A plain read of the current state, for tests. */
export function authSnapshot(): AuthState {
	return auth;
}

const seeded = new WeakSet<object>();

/** Starts the browser's auth state from an account the server read, once per
 *  seed. Quiet on purpose: it runs while a component renders. A different
 *  account from the one this tab held drops that account's data first; render
 *  it before any `AccountSeedProvider` so the new account's seed lands after. */
export function AuthSeed({ account }: { account: Account | null }) {
	if (account && typeof window !== "undefined" && !seeded.has(account)) {
		seeded.add(account);
		if (accountSwitched(auth.session, account))
			clearAccountData({ deferred: true });
		auth = { session: { kind: "signedIn", account } };
	}
	return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const { session } = useSyncExternalStore(
		subscribeAuth,
		() => auth,
		() => UNKNOWN,
	);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/auth/me");
			const body = await res.json().catch(() => null);
			dispatchSession({ type: "answered", status: res.status, body });
		} catch {
			dispatchSession({ type: "unreachable" });
		}
		const next = auth.session;
		// A signed-out answer (say, an expired session) leaves nothing of the
		// last account behind for whoever signs in next in this tab.
		if (next.kind === "signedOut") clearAccountData();
		if (next.kind === "signedIn") identifyAccount(next.account);
	}, []);

	const login = useCallback(
		async (email: string, from?: SigninFrom): Promise<{ token?: string }> => {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, from, distinctId: distinctId() }),
			});
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || "Failed to send magic link");
			}
			return data;
		},
		[],
	);

	const verify = useCallback(async (tokenOrCode: string, email?: string) => {
		const body = email ? { code: tokenOrCode, email } : { token: tokenOrCode };
		let res: Response;
		try {
			res = await fetch("/api/auth/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
			});
		} catch (err) {
			// A verify that never answers is a failure the visitor can retry,
			// not a spinner that never ends.
			const timedOut =
				err instanceof DOMException &&
				(err.name === "TimeoutError" || err.name === "AbortError");
			throw new VerifyUnreachableError(
				timedOut
					? "That took too long. Check your connection and try again."
					: "Couldn't reach Secondlayer. Try again.",
			);
		}
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || "Verification failed");
		}
		const data = await res.json();
		const account = data.account as Account;
		// A new session starts from nothing; its pages read their own data.
		clearAccountData();
		dispatchSession({ type: "signedIn", account });
		identifyAccount(account);
		announceSession(account);
		return { account };
	}, []);

	const logout = useCallback(async () => {
		await fetch("/api/auth/logout", { method: "POST" });
		clearAccountData();
		reset();
		router.push("/");
		router.refresh();
		dispatchSession({ type: "signedOut" });
		announceSession(null);
	}, [router]);

	// Another tab of this browser signed in or out: whatever this tab shows
	// belongs to the old session, so drop it and read who is signed in now.
	useEffect(() => {
		if (typeof BroadcastChannel === "undefined") return;
		const channel = new BroadcastChannel(SESSION_CHANNEL);
		channel.onmessage = (event) => {
			if (!signalStalesSession(event.data, auth.session)) return;
			clearAccountData();
			void refresh();
		};
		return () => channel.close();
	}, [refresh]);

	useEffect(() => {
		// A page that read the account on the server has already seeded it.
		if (auth.session.kind !== "unknown") {
			if (auth.session.kind === "signedIn")
				identifyAccount(auth.session.account);
			return;
		}
		refresh();
	}, [refresh]);

	return (
		<AuthContext.Provider
			value={{
				account: accountOf(session),
				loading: session.kind === "unknown",
				unreachable: session.kind === "unreachable",
				login,
				verify,
				logout,
				refresh,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthCtx {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}

/**
 * Resolve a marketing href. Pre-split this prefixed `/site` so authed users on
 * the single domain could escape the platform rewrite; with the host split,
 * marketing lives on its own host, so point straight at it.
 */
export function useSiteHref(href: string): string {
	return marketingUrl(href);
}
