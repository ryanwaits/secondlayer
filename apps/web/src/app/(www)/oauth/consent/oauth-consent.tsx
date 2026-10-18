"use client";

import { displayClientName } from "@/app/(www)/cli/login/cli-login";
import { ensureBilling, formatUsd, useAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { signInThen } from "@/lib/safe-next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** A request id as the API mints it (`oar_` + base64url). */
export const REQUEST_ID_RE = /^oar_[A-Za-z0-9_-]{1,64}$/;

export type ConsentView =
	| { kind: "loading" }
	| { kind: "review"; clientName: string; redirectHost: string }
	| { kind: "leaving"; allowed: boolean; clientName: string }
	| { kind: "gone" };

/**
 * An app (an MCP client such as Claude Code) asks to use secondlayer as you.
 * Pure, so each state renders and is checked on its own. The app's name is
 * its own claim, so it is shown as plain text and labelled unverified.
 */
export function OauthConsentCard({
	view,
	email,
	balance = null,
	busy,
	error,
	onAllow,
	onDeny,
}: {
	view: ConsentView;
	email: string | null;
	/** The account's balance, formatted; null while it loads. */
	balance?: string | null;
	busy: boolean;
	error: string | null;
	onAllow(): void;
	onDeny(): void;
}) {
	return (
		<div className="login-page">
			<div className="login-card">
				{view.kind === "loading" && (
					<p className="login-sent-desc">Loading the request…</p>
				)}
				{view.kind === "review" && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onAllow();
						}}
					>
						<span className="login-eyebrow">MCP sign-in</span>
						<h1 className="login-title">
							Allow <strong>{displayClientName(view.clientName)}</strong>{" "}
							<span className="oauth-consent-unverified">(unverified)</span> to
							use secondlayer{email ? ` as ${email}` : ""}?
						</h1>
						<p className="cli-login-lead">
							The name is the app's own claim. It returns to{" "}
							<code className="oauth-consent-host">{view.redirectHost}</code>.
						</p>
						<p className="cli-login-lead">
							It can call the hosted MCP tools: Index, Streams and contract
							reads, and subgraph scaffolds. It cannot make or revoke keys.
						</p>
						<p className="cli-login-warn">
							{balance
								? `Reads it makes use your credits (balance ${balance}).`
								: "Reads it makes use your credits."}{" "}
							Only allow an app you just connected yourself.
						</p>
						{error && <p className="login-error">{error}</p>}
						<button type="submit" className="login-submit" disabled={busy}>
							{busy ? "Allowing..." : "Allow"}
						</button>
						<button
							type="button"
							className="cli-login-cancel"
							onClick={onDeny}
							disabled={busy}
						>
							Deny
						</button>
					</form>
				)}
				{view.kind === "leaving" && (
					<div className="login-sent">
						<p className="login-sent-title">
							{view.allowed ? "Allowed." : "Denied."}
						</p>
						<p className="login-sent-desc">
							{view.allowed
								? `Returning you to ${displayClientName(view.clientName)}. Revoke it any time under Account, Keys.`
								: `${displayClientName(view.clientName)} was told no. You can close this tab.`}
						</p>
					</div>
				)}
				{view.kind === "gone" && (
					<div className="login-sent">
						<p className="login-sent-title">This sign-in can't continue.</p>
						<p className="login-sent-desc">
							It expired or was already answered. Start the sign-in again from
							your app.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

export function OauthConsent() {
	const { account, loading } = useAuth();
	const router = useRouter();
	const id = useSearchParams().get("req") ?? "";
	const valid = REQUEST_ID_RE.test(id);
	const [view, setView] = useState<ConsentView>({ kind: "loading" });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { billing } = useAccountData();
	const reviewing = view.kind === "review";

	useEffect(() => {
		if (reviewing) ensureBilling();
	}, [reviewing]);

	// Signed out: sign in, then come back here. The return path stays in this
	// browser (safe-next), never in the emailed link.
	useEffect(() => {
		if (!loading && !account && valid) {
			router.replace(
				signInThen(`/oauth/consent?req=${encodeURIComponent(id)}`),
			);
		}
	}, [loading, account, id, valid, router]);

	useEffect(() => {
		if (!valid) {
			setView({ kind: "gone" });
			return;
		}
		if (!account) return;
		let live = true;
		(async () => {
			try {
				const res = await fetch(
					`/api/oauth/requests/${encodeURIComponent(id)}`,
				);
				if (!res.ok) throw new Error("gone");
				const r = (await res.json()) as {
					clientName: string;
					redirectHost: string;
				};
				if (live)
					setView({
						kind: "review",
						clientName: r.clientName,
						redirectHost: r.redirectHost,
					});
			} catch {
				if (live) setView({ kind: "gone" });
			}
		})();
		return () => {
			live = false;
		};
	}, [account, id, valid]);

	const answer = useCallback(
		async (allow: boolean) => {
			if (view.kind !== "review") return;
			setBusy(true);
			setError(null);
			try {
				const res = await fetch(
					`/api/oauth/requests/${encodeURIComponent(id)}/${allow ? "approve" : "deny"}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: "{}",
					},
				);
				if (res.status === 404) {
					setView({ kind: "gone" });
					return;
				}
				const data = (await res.json().catch(() => ({}))) as {
					redirect?: string;
				};
				if (!res.ok || !data.redirect) throw new Error("failed");
				setView({
					kind: "leaving",
					allowed: allow,
					clientName: view.clientName,
				});
				// Back to the app's own registered address: the API built it from
				// the exact URI the app registered.
				window.location.assign(data.redirect);
			} catch {
				setError("Something went wrong. Try again.");
				setBusy(false);
			}
		},
		[id, view],
	);

	return (
		<OauthConsentCard
			view={view}
			email={account?.email ?? null}
			balance={billing ? formatUsd(billing.creditsUsdMicros) : null}
			busy={busy}
			error={error}
			onAllow={() => answer(true)}
			onDeny={() => answer(false)}
		/>
	);
}
