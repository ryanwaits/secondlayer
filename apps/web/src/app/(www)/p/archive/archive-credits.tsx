"use client";

import { useId, useRef, useState } from "react";

const PACKS = [10, 25, 50, 100] as const;

/**
 * Inline credits purchase: a "Buy credits" button that expands the panel
 * (pack templates, amount, email) and hands off to Stripe Checkout. The
 * checkout API only accepts the fixed packs, so custom amounts explain
 * themselves instead of failing at the server.
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
	// Partition prices in cents: $0.05 block or transaction, $0.15 event.
	const blockTxPartitions = isPack ? Math.floor((amount * 100) / 5) : null;
	const eventPartitions = isPack ? Math.floor((amount * 100) / 15) : null;

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
		<div className="panel">
			<div className="panel-head">
				<span>Add credits</span>
			</div>
			<div className="panel-body">
				<div className="act">
					<button
						type="button"
						className="btn btn-sec"
						aria-expanded={open}
						aria-controls={panelId}
						onClick={() => setOpen((v) => !v)}
					>
						Buy credits
					</button>
				</div>

				{open ? (
					<form
						id={panelId}
						onSubmit={(e) => {
							e.preventDefault();
							if (isPack) void checkout();
						}}
					>
						<fieldset>
							<legend>Pack</legend>
							<div className="packs">
								{PACKS.map((p) => (
									<button
										key={p}
										type="button"
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
						</fieldset>

						<label className="field">
							<span className="lab">Amount</span>
							<span className="amount">
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

						<fieldset>
							<legend>Buys about</legend>
							<div className="buys" aria-live="polite">
								<div>
									<span>block or transaction partitions</span>
									<span>{blockTxPartitions ?? "n/a"}</span>
								</div>
								<div>
									<span>event partitions</span>
									<span>{eventPartitions ?? "n/a"}</span>
								</div>
							</div>
						</fieldset>

						<label className="field">
							<span className="lab">Email</span>
							<input
								type="email"
								required
								autoComplete="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
							/>
						</label>

						<div className="act">
							<button
								type="submit"
								className="btn btn-pri"
								disabled={busy || !isPack}
							>
								{busy
									? "Opening Stripe…"
									: isPack
										? `Continue to Stripe · $${amount}`
										: "Pick a pack to continue"}
							</button>
						</div>
						{!isPack ? (
							<p className="note">
								Packs are ${PACKS.join(" / $")} today. Custom amounts arrive
								with accounts.
							</p>
						) : (
							<p className="note">
								Credits attach to this email. The CLI picks them up on the next
								metered run.
							</p>
						)}
						{error ? <p className="err">{error}</p> : null}
					</form>
				) : null}
			</div>
		</div>
	);
}
