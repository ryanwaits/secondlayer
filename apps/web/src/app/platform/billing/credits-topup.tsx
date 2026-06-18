"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import s from "./billing.module.css";

/**
 * Prepaid usage-credits top-up — the card-funded peer to the x402 agent rail.
 * Pick a fixed pack, POST /api/billing/topup, redirect to Stripe Checkout. The
 * credit lands via the checkout.session.completed webhook (not here), so on
 * return (?topup=success) we just refresh to pick up the new balance.
 */
const PACKS = [10, 25, 50, 100] as const;

export function CreditsTopup({
	balanceUsdMicros,
	spentThisMonthUsdMicros,
}: { balanceUsdMicros: string; spentThisMonthUsdMicros: string }) {
	const router = useRouter();
	const params = useSearchParams();
	const [amt, setAmt] = useState<number>(25);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refreshed = useRef(false);

	const balance = Number(balanceUsdMicros || "0") / 1_000_000;
	const spentThisMonth = Number(spentThisMonthUsdMicros || "0") / 1_000_000;

	useEffect(() => {
		if (params.get("topup") !== "success" || refreshed.current) return;
		refreshed.current = true;
		// Credit lands via webhook; clear the param and refresh to read the new balance.
		router.replace("/platform/billing");
		router.refresh();
	}, [params, router]);

	async function topup() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/billing/topup", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount: amt }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) throw new Error(data.error ?? "Top-up failed");
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Top-up failed");
			setBusy(false);
		}
	}

	return (
		<>
			<div className={s.sec}>
				<span>usage credits</span>
			</div>
			<div className={s.ledger}>
				<div className={s.head}>
					<span className={s.name}>Credits</span>
					<span className={s.price}>
						${balance.toFixed(2)}
						<small>remaining</small>
					</span>
				</div>
				<div className={s.erow}>
					<span>Draws down on</span>
					<span className={s.val}>reads beyond the free window</span>
				</div>
				<div className={s.erow}>
					<span>Spent this month</span>
					<span className={s.val}>${spentThisMonth.toFixed(2)}</span>
				</div>
				<fieldset className={s.credPacks}>
					<legend className={s.srOnly}>Top-up amount</legend>
					{PACKS.map((p) => (
						<label
							key={p}
							className={`${s.credChip} ${amt === p ? s.credChipOn : ""}`}
						>
							<input
								type="radio"
								name="credits-topup"
								className={s.srOnly}
								checked={amt === p}
								onChange={() => setAmt(p)}
							/>
							${p}
						</label>
					))}
				</fieldset>
				<div className={s.creditCta}>
					{error && <span className={s.actErr}>{error}</span>}
					<button
						type="button"
						className={s.btnInk}
						onClick={topup}
						disabled={busy}
					>
						{busy ? "Redirecting…" : `Add $${amt} in credits`}
					</button>
				</div>
			</div>
		</>
	);
}
