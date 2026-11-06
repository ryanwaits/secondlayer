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
import { identify, reset } from "./analytics";
import type { Account } from "./types";
import { marketingUrl } from "./urls";

interface AuthCtx {
	account: Account | null;
	loading: boolean;
	login(email: string): Promise<{ token?: string; code?: string }>;
	verify(tokenOrCode: string, email?: string): Promise<{ account: Account }>;
	logout(): Promise<void>;
	refresh(): Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

type AuthState = { account: Account | null; loading: boolean };

/** What the server render and the first hydration pass see: not yet known. */
const UNKNOWN: AuthState = { account: null, loading: true };

// A module store, so a page that already read the account on the server can
// hand it over before the provider's first effect. Browser-only writes: the
// module is shared across requests on the server.
let auth: AuthState = UNKNOWN;
const listeners = new Set<() => void>();

function setAuth(patch: Partial<AuthState>) {
	auth = { ...auth, ...patch };
	for (const l of listeners) l();
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
 *  seed. Quiet on purpose: it runs while a component renders. A null account
 *  (signed out, or a stale cookie) leaves the state unknown, so the provider
 *  then asks `/api/auth/me` as it always has. */
export function AuthSeed({ account }: { account: Account | null }) {
	if (account && typeof window !== "undefined" && !seeded.has(account)) {
		seeded.add(account);
		auth = { account, loading: false };
	}
	// Wakes whoever rendered before this seed arrived (the frame, the nav).
	useEffect(() => {
		for (const l of listeners) l();
	}, []);
	return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const { account, loading } = useSyncExternalStore(
		subscribeAuth,
		() => auth,
		() => UNKNOWN,
	);
	const setAccount = useCallback(
		(next: Account | null) => setAuth({ account: next }),
		[],
	);
	const setLoading = useCallback(
		(next: boolean) => setAuth({ loading: next }),
		[],
	);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/auth/me");
			const data = await res.json();
			const account = data.account ?? null;
			setAccount(account);
			// A signed-out answer (say, an expired session) leaves nothing of the
			// last account behind for whoever signs in next in this tab.
			if (!account) clearAccountData();
			if (account) {
				identify(account.id, {
					email: account.email,
					...(account.displayName ? { name: account.displayName } : {}),
				});
			}
		} catch {
			setAccount(null);
		} finally {
			setLoading(false);
		}
	}, [setAccount, setLoading]);

	const login = useCallback(
		async (email: string): Promise<{ token?: string }> => {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || "Failed to send magic link");
			}
			return data;
		},
		[],
	);

	const verify = useCallback(
		async (tokenOrCode: string, email?: string) => {
			const body = email
				? { code: tokenOrCode, email }
				: { token: tokenOrCode };
			const res = await fetch("/api/auth/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || "Verification failed");
			}
			const data = await res.json();
			const account = data.account as Account;
			// A new session starts from nothing; its pages read their own data.
			clearAccountData();
			setAccount(account);
			identify(account.id, {
				email: account.email,
				...(account.displayName ? { name: account.displayName } : {}),
			});
			return { account };
		},
		[setAccount],
	);

	const logout = useCallback(async () => {
		await fetch("/api/auth/logout", { method: "POST" });
		clearAccountData();
		reset();
		router.push("/");
		router.refresh();
		setAccount(null);
	}, [router, setAccount]);

	useEffect(() => {
		if (auth.loading) {
			refresh();
			return;
		}
		if (auth.account) {
			identify(auth.account.id, {
				email: auth.account.email,
				...(auth.account.displayName ? { name: auth.account.displayName } : {}),
			});
		}
	}, [refresh]);

	return (
		<AuthContext.Provider
			value={{ account, loading, login, verify, logout, refresh }}
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
