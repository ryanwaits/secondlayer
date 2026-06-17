"use client";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Always-platform paths (no marketing equivalent)
const PLATFORM_PATHS = ["/platform", "/api-keys", "/billing", "/settings"];

// Paths that serve marketing when unauthed, platform when authed (mirrors middleware DUAL_PATHS)
const DUAL_PATHS = ["/subgraphs"];

export function AuthBar() {
	const { account, loading, login, logout } = useAuth();
	const pathname = usePathname();
	const router = useRouter();
	const [expanded, setExpanded] = useState(false);
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
		"idle",
	);
	const inputRef = useRef<HTMLInputElement>(null);

	const isDualPath = DUAL_PATHS.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);
	const isPlatform =
		((pathname === "/" || isDualPath) && !!account) ||
		PLATFORM_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

	useEffect(() => {
		if (expanded && inputRef.current) {
			inputRef.current.focus();
		}
	}, [expanded]);

	// D keyboard shortcut → docs (available regardless of auth state)
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "d" || e.key === "D") router.push("/docs");
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [router]);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!email || status === "sending") return;
			setStatus("sending");
			try {
				await login(email);
				setStatus("done");
			} catch {
				setStatus("error");
				setTimeout(() => setStatus("idle"), 2000);
			}
		},
		[email, login, status],
	);

	if (loading) return null;

	// Platform pages — sidebar handles logout, never show auth bar
	// If session expired (no account but cookie exists), the /api/auth/me route
	// already cleared the cookie server-side — reload so middleware routes to marketing
	// Platform pages — sidebar handles everything, never show auth bar
	if (isPlatform) return null;

	// Authenticated on marketing pages. Two groups: nav (Home/Docs) and account
	// actions (Log out / Platform), split by a divider. Home → /site keeps the
	// marketing site reachable (authed `/` rewrites to the platform dashboard).
	if (account) {
		return (
			<div className="auth-bar">
				<Link href="/site" className="auth-bar-nav-link">
					Home
				</Link>
				<span className="auth-bar-sep" aria-hidden="true" />
				<button
					type="button"
					className="auth-bar-login"
					onClick={() => logout()}
				>
					Log out
				</button>
				<Link href="/" className="auth-bar-cta">
					Platform
				</Link>
			</div>
		);
	}

	// Unauthenticated
	return (
		<div className="auth-bar">
			<Link
				href="/login"
				className="auth-bar-nav-link"
				data-umami-event="login"
			>
				<span className="auth-bar-nav-label">Sign in</span>
			</Link>
			{status === "done" ? (
				<span className="auth-bar-done">
					Check your email for a sign-in link.
				</span>
			) : (
				<form
					className={`auth-bar-notify ${expanded ? "expanded" : ""}`}
					onSubmit={handleSubmit}
				>
					<input
						ref={inputRef}
						type="text"
						inputMode="email"
						className="auth-bar-input"
						placeholder="you@email.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								setExpanded(false);
								setEmail("");
							}
						}}
						onBlur={() => {
							if (!email) {
								setExpanded(false);
							}
						}}
						tabIndex={expanded ? 0 : -1}
					/>
					<button
						type={expanded ? "submit" : "button"}
						className="auth-bar-cta"
						data-umami-event="signup"
						disabled={status === "sending"}
						onClick={() => {
							if (!expanded) setExpanded(true);
						}}
					>
						{status === "sending" ? "..." : "Get an API key"}
					</button>
				</form>
			)}
		</div>
	);
}
