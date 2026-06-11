"use client";

import { useState } from "react";

const API_BASE =
	process.env.NEXT_PUBLIC_API_URL ?? "https://api.secondlayer.tools";

type Phase = "email" | "code" | "done" | "invalid";

/**
 * Two-phase ghost-key claim. The claim token rides along on both calls —
 * the magic link itself carries no claim state (see the API seam note).
 */
export function ClaimFlow({ token }: { token: string }) {
	const [phase, setPhase] = useState<Phase>("email");
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [claimedEmail, setClaimedEmail] = useState<string | null>(null);

	async function post(path: string, body: unknown) {
		const res = await fetch(`${API_BASE}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(
				typeof json === "object" && json && "error" in json
					? String((json as { error: unknown }).error)
					: `Request failed (${res.status})`,
			);
		}
		return json as Record<string, unknown>;
	}

	async function sendLink(e: React.FormEvent) {
		e.preventDefault();
		if (!email || busy) return;
		setBusy(true);
		setError(null);
		try {
			await post("/api/auth/claim", { token, email });
			setPhase("code");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Something went wrong";
			if (msg.toLowerCase().includes("claim token")) setPhase("invalid");
			else setError(msg);
		} finally {
			setBusy(false);
		}
	}

	async function verify(e: React.FormEvent) {
		e.preventDefault();
		if (code.length !== 6 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const res = await post("/api/auth/claim/verify", { token, code, email });
			const account = res.account as { email?: string } | undefined;
			setClaimedEmail(account?.email ?? email);
			setPhase("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	}

	if (phase === "invalid") {
		return (
			<div className="claim-card">
				<p className="claim-error">
					This claim link is invalid, expired, or already used. Keys are
					claimable for 30 days after minting — you can mint a fresh one from
					the homepage and start over.
				</p>
			</div>
		);
	}

	if (phase === "done") {
		return (
			<div className="claim-card">
				<p className="claim-done">
					Done — this key now belongs to <strong>{claimedEmail}</strong>. It
					keeps working exactly as before. Log in to manage it.
				</p>
				<a className="auth-bar-cta" href="/login">
					Log in
				</a>
			</div>
		);
	}

	return (
		<div className="claim-card">
			{phase === "email" ? (
				<form onSubmit={sendLink} className="claim-form">
					<label htmlFor="claim-email">Your email</label>
					<input
						id="claim-email"
						type="email"
						required
						placeholder="you@email.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
					<button type="submit" className="auth-bar-cta" disabled={busy}>
						{busy ? "Sending…" : "Send code"}
					</button>
				</form>
			) : (
				<form onSubmit={verify} className="claim-form">
					<label htmlFor="claim-code">
						Enter the 6-digit code we sent to {email}
					</label>
					<input
						id="claim-code"
						inputMode="numeric"
						pattern="[0-9]{6}"
						maxLength={6}
						autoComplete="one-time-code"
						value={code}
						onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
					/>
					<button
						type="submit"
						className="auth-bar-cta"
						disabled={busy || code.length !== 6}
					>
						{busy ? "Claiming…" : "Claim key"}
					</button>
				</form>
			)}
			{error && <p className="claim-error">{error}</p>}
		</div>
	);
}
