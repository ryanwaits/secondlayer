"use client";

import { useId, useRef, useState } from "react";

const PACKS = [10, 25, 50, 100] as const;

/**
 * Inline credits purchase: a quiet "Buy credits" button that expands an
 * in-place panel — amount field with pack templates — and hands off to
 * Stripe Checkout. Email is the whole account for now; the checkout API
 * only accepts the fixed packs, so custom amounts explain themselves
 * instead of failing at the server.
 */
export function ArchiveCredits() {
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState<number>(25);
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const panelId = useId();
	const amountRef = useRef<HTMLInputElement>(null);

	const isPack = (PACKS as readonly number[]).includes(amount);

	async function checkout() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/public/credits/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, amount }),
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
		<div className="acr">
			<button
				type="button"
				className="acr-open"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((v) => !v)}
			>
				Buy credits
			</button>

			{open ? (
				<form
					id={panelId}
					className="acr-panel"
					onSubmit={(e) => {
						e.preventDefault();
						if (isPack) void checkout();
					}}
				>
					<div className="acr-amount-row">
						<label className="acr-amount">
							<span className="acr-label">Amount</span>
							<span className="acr-amount-in">
								<span aria-hidden="true">$</span>
								<input
									ref={amountRef}
									type="number"
									inputMode="numeric"
									min={1}
									step={1}
									value={Number.isNaN(amount) ? "" : amount}
									onChange={(e) => setAmount(e.target.valueAsNumber)}
								/>
							</span>
						</label>
						<div
							className="acr-packs"
							role="group"
							aria-label="Credit pack templates"
						>
							{PACKS.map((p) => (
								<button
									key={p}
									type="button"
									className={amount === p ? "on" : undefined}
									aria-pressed={amount === p}
									onClick={() => {
										setAmount(p);
										amountRef.current?.focus();
									}}
								>
									${p}
								</button>
							))}
						</div>
					</div>

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
						<button
							type="submit"
							className="acr-continue"
							disabled={busy || !isPack}
						>
							{busy
								? "Opening Stripe…"
								: `Continue to Stripe · $${isPack ? amount : "—"}`}
						</button>
						{!isPack ? (
							<p className="acr-note">
								Packs are ${PACKS.join(" / $")} today. Custom amounts arrive
								with accounts.
							</p>
						) : (
							<p className="acr-note">
								Credits attach to this email. The CLI picks them up on the next
								metered run.
							</p>
						)}
					</div>
					{error ? <p className="acr-err">{error}</p> : null}
				</form>
			) : null}
		</div>
	);
}
