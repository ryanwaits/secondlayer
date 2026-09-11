"use client";

import { MarketingNav } from "@/components/marketing-nav";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

const TOKEN_RE = /^[0-9a-f]{64}$/i;

export default function ClaimPage() {
	const params = useParams<{ token: string }>();
	const search = useSearchParams();
	const token = typeof params.token === "string" ? params.token : "";
	const paid = search.get("paid") === "1";
	const valid = TOKEN_RE.test(token);

	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function checkout() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/public/credits/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, amount: 10, claim_token: token }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url)
				throw new Error(data.error ?? "Checkout failed");
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Checkout failed");
			setBusy(false);
		}
	}

	return (
		<div className="login-page">
			<MarketingNav />
			<div className="login-card">
				{!valid ? (
					<p className="acr-err">This claim link is invalid.</p>
				) : paid ? (
					<>
						<p className="login-title">Paid.</p>
						<p className="login-sent-desc">
							Log in at /login with the same email.
						</p>
					</>
				) : (
					<form
						className="acr-panel"
						onSubmit={(e) => {
							e.preventDefault();
							void checkout();
						}}
					>
						<p className="login-title">Claim play resources</p>
						<p className="acr-note">
							First $10 credit pack. Subgraph and key move to this email.
						</p>
						<label className="acr-email">
							<span className="acr-label">Email</span>
							<input
								type="email"
								required
								autoComplete="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
							/>
						</label>
						<div className="acr-actions">
							<button type="submit" className="acr-continue" disabled={busy}>
								{busy ? "Opening Stripe" : "Continue to Stripe · $10"}
							</button>
						</div>
						{error ? <p className="acr-err">{error}</p> : null}
					</form>
				)}
			</div>
		</div>
	);
}
