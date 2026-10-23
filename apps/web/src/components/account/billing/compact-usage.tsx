"use client";

import { type Billing, PACKS_USD } from "@/lib/account-data";
import type { Burn } from "@/lib/usage";
import type { ReactNode } from "react";
import type { useCheckout } from "../credits-panel";

const MICROS = 1_000_000;
function Kv({ k, children }: { k: ReactNode; children: ReactNode }) {
	return (
		<div className="mac-kv">
			<span className="mac-k">{k}</span>
			<span className="mac-v">{children}</span>
		</div>
	);
}

type Checkout = ReturnType<typeof useCheckout>;

/** The top-up sheet's contents: amount, what it does to the balance, off to Stripe. */
export function TopupSheetBody({
	co,
	billing,
	burn,
}: {
	co: Checkout;
	billing: Billing | null;
	burn: Burn | null;
}) {
	const balance = billing ? Number(billing.creditsUsdMicros) / MICROS : 0;
	const after = balance + co.amount;
	const rateDay = burn ? Number(burn.rateDayUsdMicros) / MICROS : 0;
	const lasts = rateDay > 0 ? Math.max(1, Math.round(after / rateDay)) : null;
	return (
		<>
			<fieldset className="mac-amts">
				<legend className="m-sr">Amount</legend>
				{PACKS_USD.slice(0, 3).map((amount) => (
					<button
						key={amount}
						type="button"
						aria-pressed={co.amount === amount}
						onClick={() => co.choose(amount)}
					>
						${amount}
					</button>
				))}
			</fieldset>
			<div className="mac-group">
				<Kv k="Balance after">${after.toFixed(2)}</Kv>
				{lasts !== null ? (
					<Kv k="Lasts about">{lasts} days at this pace</Kv>
				) : null}
			</div>
			<p className="mac-fine">
				Paid with Stripe Checkout. Apple Pay and Google Pay work there. You come
				back here when it's done.
			</p>
			{co.error ? <p className="mac-error">{co.error}</p> : null}
			<button
				type="button"
				className="mac-btn is-pri is-wide"
				disabled={co.busy || !co.valid}
				onClick={co.checkout}
			>
				{co.busy ? "Opening Stripe…" : "Continue to Stripe"}
			</button>
		</>
	);
}
