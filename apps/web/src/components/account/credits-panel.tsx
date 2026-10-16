"use client";

import {
	type Billing,
	type TopupReturn,
	ensureBilling,
	formatUsd,
	refreshBilling,
	startCheckout,
	topupLanded,
	useAccountData,
} from "@/lib/account-data";
import { TOPUP_MAX_USD, TOPUP_MIN_USD } from "@/lib/prices";
import { type Burn, runsOutMonth } from "@/lib/usage";
import { useEffect, useState } from "react";
import { AmountChoice } from "./billing/amount-choice";
import { RatesTable } from "./billing/rates-table";
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

export function useCheckout() {
	const [amount, setAmount] = useState<number>(25);
	const [valid, setValid] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** A valid amount, or null while the Other box holds something invalid. */
	function choose(next: number | null) {
		setValid(next !== null);
		if (next !== null) setAmount(next);
	}
	async function checkout() {
		if (!valid) return;
		setBusy(true);
		setError(null);
		try {
			await startCheckout(amount);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't start checkout");
			setBusy(false);
		}
	}
	return { amount, valid, choose, busy, error, checkout };
}

type Checkout = ReturnType<typeof useCheckout>;

/** What the picked amount does to the balance, and when it runs out. */
export function RunwayLine({
	amount,
	valid,
	balanceUsdMicros,
	rateDayUsdMicros,
	stopped,
	now,
}: {
	amount: number;
	valid: boolean;
	balanceUsdMicros: number;
	rateDayUsdMicros: number;
	stopped: boolean;
	now: Date;
}) {
	if (!valid) {
		return (
			<p className="bl-runway err">
				Pick a whole-dollar amount from ${TOPUP_MIN_USD} to $
				{TOPUP_MAX_USD.toLocaleString("en-US")}.
			</p>
		);
	}
	const after = balanceUsdMicros + amount * 1e6;
	const goesTo = `Balance goes to ${formatUsd(after)}`;
	if (stopped)
		return (
			<p className="bl-runway">{goesTo}, and your hosted stack starts again.</p>
		);
	const month = runsOutMonth(after, rateDayUsdMicros, now);
	if (month === null) return <p className="bl-runway">{goesTo}.</p>;
	return (
		<p className="bl-runway">
			{goesTo}, which lasts until about <b>{month}</b>.
		</p>
	);
}

/** Go to Stripe for the picked amount. Stripe brings the reader back after. */
export function CheckoutAction({ co }: { co: Checkout }) {
	return (
		<>
			<div className="acct-checkout">
				<button
					type="button"
					className="acct-btn solid small"
					onClick={co.checkout}
					disabled={co.busy || !co.valid}
				>
					{co.busy
						? "Opening checkout..."
						: co.valid
							? `Add $${co.amount} with Stripe`
							: "Add credits with Stripe"}
				</button>
				<p className="acct-fine">One-time payment. Nothing auto-renews.</p>
			</div>
			{co.error ? <p className="acct-error">{co.error}</p> : null}
		</>
	);
}

/** Pick an amount, see where it takes the balance, then off to Stripe. One
 *  panel for the billing page and the account menu's sheet. */
export function AddCredits({
	co,
	billing,
	burn,
	stopped,
}: {
	co: Checkout;
	billing: Billing | null;
	burn: Burn | null;
	stopped: boolean;
}) {
	const rate = burn ? Number(burn.rateDayUsdMicros) : 0;
	return (
		<>
			<AmountChoice value={co.amount} onChange={co.choose} />
			{billing ? (
				<RunwayLine
					amount={co.amount}
					valid={co.valid}
					balanceUsdMicros={Number(billing.creditsUsdMicros)}
					rateDayUsdMicros={rate}
					stopped={stopped}
					now={new Date()}
				/>
			) : null}
			<CheckoutAction co={co} />
			{burn && rate > 0 ? (
				<p className="bl-est">
					<span className="dash-label">Estimate</span>
					<span>
						From your last {burn.windowHours} hours of spend,{" "}
						<code>{formatUsd(rate)}</code> a day. A busier stretch ends sooner.
					</span>
				</p>
			) : null}
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
	const { billing, burn, service } = useAccountData();
	const co = useCheckout();
	useEffect(() => {
		if (open) ensureBilling();
	}, [open]);

	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			expandHref="/account/credits"
			title="Add credits"
			subtitle={`Credits go to ${email}`}
		>
			<BalanceStats billing={billing} />
			<AddCredits
				co={co}
				billing={billing}
				burn={burn}
				stopped={service?.state === "stopped"}
			/>
			<RatesTable />
		</FloatingCard>
	);
}

export type ReturnState =
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
export function useTopupReturn(ret: TopupReturn | null): ReturnState | null {
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

export function ReturnNotice({
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
