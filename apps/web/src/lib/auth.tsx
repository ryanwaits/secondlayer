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
	loading: boolean;
	unreachable: boolean;
	login(
		email: string,
		from?: SigninFrom,
	): Promise<{ token?: string; code?: string }>;
	verify(tokenOrCode: string, email?: string): Promise<{ account: Account }>;
	logout(): Promise<void>;
	refresh(): Promise<void>;
}

export class VerifyUnreachableError extends Error {}

export type SigninFrom = "signin" | "lasting_key";

/** `$internal_or_test_user` is what PostHog's internal-and-test filter reads;
 *  it is sent only when the account payload carries `internal`. */
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

const UNKNOWN: AuthState = { session: SESSION_UNKNOWN };

// Browser-only writes: the module is shared across requests on the server.
let auth: AuthState = UNKNOWN;
const listeners = new Set<() => void>();

function dispatchSession(event: SessionEvent) {
	const session = sessionReducer(auth.session, event);
	if (session === auth.session) return;
	auth = { session };
	for (const l of listeners) l();
}

function announceSession(account: Account | null): void {
	if (typeof BroadcastChannel === "undefined") return;
	try {
		const channel = new BroadcastChannel(SESSION_CHANNEL);
		channel.postMessage(sessionSignal(account));
		channel.close();
	} catch {}
}

function subscribeAuth(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function authSnapshot(): AuthState {
	return auth;
}

const seeded = new WeakSet<object>();

/** Quiet on purpose: it runs while a component renders. A different account
 *  from the one this tab held drops that account's data first; render it
 *  before any `AccountSeedProvider` so the new account's seed lands after. */
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

export function useSiteHref(href: string): string {
	return marketingUrl(href);
}
