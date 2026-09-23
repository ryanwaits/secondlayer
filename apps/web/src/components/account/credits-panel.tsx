"use client";

import {
	type Billing,
	PACKS_USD,
	type PackUsd,
	type TopupReturn,
	formatUsd,
	refreshBilling,
	startCheckout,
	topupLanded,
	useAccountData,
} from "@/lib/account-data";
import { useEffect, useId, useState } from "react";
import { FloatingCard } from "./floating-card";

export function BalanceStats({ billing }: { billing: Billing | null }) {
	return (
		<div className="acct-stats">
			<div className="acct-stat">
				<span className="acct-stat-k">Balance</span>
				<span className="acct-stat-v">
					{billing ? formatUsd(billing.creditsUsdMicros) : "..."}
				</span>
			</div>
			<div className="acct-stat">
				<span className="acct-stat-k">Spent this month</span>
				<span className="acct-stat-v">
					{billing ? formatUsd(billing.spentThisMonthUsdMicros) : "..."}
				</span>
			</div>
		</div>
	);
}

function PricingNote() {
	return (
		<p className="acct-pricing">
			The last 24 hours of data are free with any key. Older history costs{" "}
			<strong>$5 per 1M rows</strong>, then $2 per 1M past $50 in a month.
		</p>
	);
}

function useCheckout() {
	const [amount, setAmount] = useState<PackUsd>(25);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function checkout() {
		setBusy(true);
		setError(null);
		try {
			await startCheckout(amount);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't start checkout");
			setBusy(false);
		}
	}
	return { amount, setAmount, busy, error, checkout };
}

type Checkout = ReturnType<typeof useCheckout>;

/** The four amounts the API sells, as one radio group. */
function AmountPicker({ co, wide = false }: { co: Checkout; wide?: boolean }) {
	// Its own radio group: the page and the card can both be on screen.
	const group = useId();
	return (
		<fieldset className={wide ? "acct-packs wide" : "acct-packs"}>
			<legend>Amount</legend>
			{PACKS_USD.map((usd) => (
				<label key={usd} className="acct-pack">
					<input
						type="radio"
						name={group}
						value={usd}
						checked={co.amount === usd}
						onChange={() => co.setAmount(usd)}
					/>
					<span className="acct-pack-amount">${usd}</span>
					<span className="acct-pack-dot" aria-hidden="true" />
				</label>
			))}
		</fieldset>
	);
}

/** Go to Stripe for the picked amount. Stripe brings the reader back after. */
function CheckoutAction({
	co,
	wide = false,
}: { co: Checkout; wide?: boolean }) {
	return (
		<>
			<div className={wide ? "acct-checkout wide" : "acct-checkout"}>
				<button
					type="button"
					className="acct-btn solid"
					onClick={co.checkout}
					disabled={co.busy}
				>
					{co.busy
						? "Opening checkout..."
						: `Continue to checkout · $${co.amount}`}
				</button>
				<p className="acct-fine">
					Stripe takes the payment, then brings you back.
				</p>
			</div>
			{co.error ? <p className="acct-error">{co.error}</p> : null}
		</>
	);
}

/** The credits flow in a floating card: balance, amount, then off to Stripe. */
export function CreditsCard({
	open,
	onClose,
	email,
}: {
	open: boolean;
	onClose: () => void;
	email: string;
}) {
	const { billing } = useAccountData();
	const co = useCheckout();
	useEffect(() => {
		if (open) refreshBilling();
	}, [open]);

	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			expandHref="/account/credits"
			title="Add credits"
			subtitle={`Credits go to ${email}`}
			footer={<CheckoutAction co={co} />}
		>
			<BalanceStats billing={billing} />
			<AmountPicker co={co} />
			<PricingNote />
		</FloatingCard>
	);
}

type ReturnState =
	| { kind: "pending"; amount: number | null }
	| { kind: "slow" }
	| { kind: "landed"; amount: number | null }
	| { kind: "cancelled" };

const POLL_MS = 2000;
const POLL_TRIES = 30;

/**
 * Back from Stripe: Stripe's confirmation reaches our API a few seconds after
 * the redirect, so poll the balance until the top-up shows, then say so.
 */
function useTopupReturn(ret: TopupReturn | null): ReturnState | null {
	const [st, setSt] = useState<ReturnState | null>(null);

	useEffect(() => {
		if (!ret) return;
		if (ret.result === "cancelled") {
			setSt({ kind: "cancelled" });
			return;
		}
		let stopped = false;
		let tries = 0;
		setSt({ kind: "pending", amount: ret.amount });
		const tick = async () => {
			const billing = await refreshBilling();
			if (stopped) return;
			if (topupLanded(billing, ret.amount, ret.beforeMicros)) {
				setSt({ kind: "landed", amount: ret.amount });
				return;
			}
			if (++tries < POLL_TRIES) setTimeout(tick, POLL_MS);
			else setSt({ kind: "slow" });
		};
		tick();
		return () => {
			stopped = true;
		};
	}, [ret]);

	return st;
}

function ReturnNotice({
	st,
	billing,
}: {
	st: ReturnState;
	billing: Billing | null;
}) {
	if (st.kind === "cancelled") {
		return (
			<output className="acct-muted acct-block">
				Checkout cancelled. Nothing was charged.
			</output>
		);
	}
	if (st.kind === "slow") {
		return (
			<output className="acct-muted acct-block">
				Stripe has the payment but hasn't confirmed it to us yet. Your balance
				updates as soon as it does; check back in a minute.
			</output>
		);
	}
	if (st.kind === "pending") {
		return (
			<output className="acct-pending">
				<span className="acct-spinner" aria-hidden="true" />
				<span>
					<span className="acct-pending-title acct-block">
						Confirming your payment
					</span>
					<span className="acct-muted acct-block">
						Usually a few seconds. This updates by itself.
					</span>
				</span>
			</output>
		);
	}
	return (
		<div className="acct-result">
			<output>
				<span className="acct-result-title acct-block">
					{st.amount ? `$${st.amount.toFixed(2)} added` : "Payment received"}
				</span>
				<span className="acct-result-line acct-block">
					Stripe confirmed the payment. It's in your balance now.
				</span>
			</output>
			<BalanceStats billing={billing} />
		</div>
	);
}

/** The credits flow on /account/credits, including the way back from Stripe. */
export function CreditsSection({ ret }: { ret: TopupReturn | null }) {
	const { billing } = useAccountData();
	const st = useTopupReturn(ret);
	const co = useCheckout();

	useEffect(() => {
		refreshBilling();
	}, []);

	return (
		<>
			{st ? <ReturnNotice st={st} billing={billing} /> : null}
			{st?.kind === "landed" ? null : <BalanceStats billing={billing} />}
			<h2 className="acct-h2">Add credits</h2>
			<AmountPicker co={co} wide />
			<CheckoutAction co={co} wide />
			<PricingNote />
		</>
	);
}
