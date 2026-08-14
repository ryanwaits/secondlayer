"use client";

import { useState } from "react";

const PACKS = [10, 25, 50, 100] as const;

export function CreditsBuy() {
	const [email, setEmail] = useState("");
	const [pack, setPack] = useState<(typeof PACKS)[number]>(25);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function buy() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/public/credits/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, amount: pack }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) {
				throw new Error(data.error ?? "Checkout failed");
			}
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Checkout failed");
			setBusy(false);
		}
	}

	return (
		<form
			className="home-credits"
			onSubmit={(e) => {
				e.preventDefault();
				void buy();
			}}
		>
			<label className="home-credits-email">
				<span>Email</span>
				<input
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
				/>
			</label>
			<fieldset className="home-credits-packs">
				<legend>Pack</legend>
				{PACKS.map((p) => (
					<button
						key={p}
						type="button"
						className={pack === p ? "on" : undefined}
						aria-pressed={pack === p}
						onClick={() => setPack(p)}
					>
						${p}
					</button>
				))}
			</fieldset>
			<button type="submit" className="home-credits-buy" disabled={busy}>
				{busy ? "Redirecting…" : `Buy $${pack} credits`}
			</button>
			{error && <p className="home-credits-err">{error}</p>}
			<p className="home-credits-cli">
				Or{" "}
				<code>
					secondlayer credits buy --email you@example.com --pack {pack}
				</code>
			</p>
		</form>
	);
}
