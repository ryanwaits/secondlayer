"use client";

import {
	type Billing,
	type TopupReturn,
	ensureBilling,
	formatUsd,
	refreshBilling,
	refreshCredits,
	startCheckout,
	topupStatus,
	useAccountData,
} from "@/lib/account-data";
import { TOPUP_MAX_USD, TOPUP_MIN_USD } from "@/lib/prices";
import { stackStatus } from "@/lib/stack-status";
import { type Burn, runsOutMonth } from "@/lib/usage";
import { useEffect, useReducer, useState } from "react";
import { AmountChoice } from "./billing/amount-choice";
import { CHECKOUT_EDITING, checkoutReducer } from "./checkout-flow";
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
	const [flow, dispatch] = useReducer(checkoutReducer, CHECKOUT_EDITING);
	// Back from Stripe via the browser's back button restores this page as it
	// was, mid-redirect; start over instead of staying on "Opening checkout...".
	useEffect(() => {
		const onShow = (e: PageTransitionEvent) => {
			if (e.persisted) dispatch({ type: "reset" });
		};
		window.addEventListener("pageshow", onShow);
		return () => window.removeEventListener("pageshow", onShow);
	}, []);
	/** A valid amount, or null while the Other box holds something invalid. */
	function choose(next: number | null) {
		setValid(next !== null);
		if (next !== null) setAmount(next);
	}
	async function checkout() {
		if (!valid || flow.step === "redirecting") return;
		dispatch({ type: "start" });
		try {
			await startCheckout(amount);
		} catch (e) {
			dispatch({
				type: "fail",
				error: e instanceof Error ? e.message : "Couldn't start checkout",
			});
		}
	}
	return {
		amount,
		valid,
		choose,
		busy: flow.step === "redirecting",
		error: flow.step === "failed" ? flow.error : null,
		checkout,
	};
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
	oneTime = false,
}: {
	amount: number;
	valid: boolean;
	balanceUsdMicros: number;
	rateDayUsdMicros: number;
	stopped: boolean;
	now: Date;
	/** Say "One-time payment." here, where no fine print follows the button. */
	oneTime?: boolean;
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
	const goesTo = <b className="bl-num">{formatUsd(after)}</b>;
	const once = oneTime ? " One-time payment." : "";
	if (stopped)
		return (
			<p className="bl-runway">
				Balance goes to {goesTo}, and your hosted stack starts again.{once}
			</p>
		);
	const month = runsOutMonth(after, rateDayUsdMicros, now);
	if (month === null)
		return (
			<p className="bl-runway">
				Balance goes to {goesTo}.{once}
			</p>
		);
	return (
		<p className="bl-runway">
			Balance goes to {goesTo}, about <b>{month}</b> at this pace.{once}
		</p>
	);
}

function CheckoutButton({ co }: { co: Checkout }) {
	return (
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
	);
}

/** Go to Stripe for the picked amount. Stripe brings the reader back after. */
export function CheckoutAction({ co }: { co: Checkout }) {
	return (
		<>
			<div className="acct-checkout">
				<CheckoutButton co={co} />
				<p className="acct-fine">One-time payment. Nothing auto-renews.</p>
			</div>
			{co.error ? <p className="acct-error">{co.error}</p> : null}
		</>
	);
}

/** Pick an amount, see where it takes the balance, then off to Stripe. One
 *  flow for the billing page's band and the account menu's sheet. With `band`
 *  the three parts are bare cells of the band's grid and the line carries
 *  "One-time payment."; otherwise they stack with the fine print. */
export function AddCredits({
	co,
	billing,
	burn,
	stopped,
	band = false,
}: {
	co: Checkout;
	billing: Billing | null;
	burn: Burn | null;
	stopped: boolean;
	band?: boolean;
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
					oneTime={band}
				/>
			) : band ? (
				// Holds the band's middle cell while the balance loads.
				<p className="bl-runway" />
			) : null}
			{band ? (
				<div className="bl-band-pay">
					<CheckoutButton co={co} />
					{co.error ? <p className="acct-error">{co.error}</p> : null}
				</div>
			) : (
				<CheckoutAction co={co} />
			)}
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
	email: string | null;
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
			subtitle={`Credits go to ${email ?? "this account"}`}
		>
			<BalanceStats billing={billing} />
			<AddCredits
				co={co}
				billing={billing}
				burn={burn}
				stopped={
					stackStatus({
						service: service?.state ?? null,
						stack: service?.stack,
						read: null,
						creditsUsdMicros: billing?.creditsUsdMicros ?? null,
					}) === "stopped_no_credits"
				}
			/>
		</FloatingCard>
	);
}

export type ReturnState =
	| { kind: "pending"; amount: number | null }
	| { kind: "slow" }
	/** Back from Stripe with nothing to compare against: not confirmed, not denied. */
	| { kind: "unknown"; amount: number | null }
	| { kind: "landed"; amount: number | null }
	| { kind: "cancelled" };

const POLL_MS = 2000;
const POLL_TRIES = 30;

/**
 * Back from Stripe: Stripe's confirmation reaches our API a few seconds after
 * the redirect, so poll the credits list until the top-up shows, then say so.
 * With no list from before checkout there is nothing to tell the new top-up
 * from an old one, so it says so instead of claiming a landing.
 */
export function useTopupReturn(ret: TopupReturn | null): ReturnState | null {
	const [st, setSt] = useState<ReturnState | null>(null);

	useEffect(() => {
		if (!ret) return;
		if (ret.result === "cancelled") {
			setSt({ kind: "cancelled" });
			return;
		}
		if (ret.creditsBaseline === null) {
			setSt({ kind: "unknown", amount: ret.amount });
			refreshBilling();
			refreshCredits();
			return;
		}
		let stopped = false;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		setSt({ kind: "pending", amount: ret.amount });
		const tick = async () => {
			const [credits] = await Promise.all([refreshCredits(), refreshBilling()]);
			if (stopped) return;
			if (topupStatus(credits, ret.amount, ret.creditsBaseline) === "landed") {
				setSt({ kind: "landed", amount: ret.amount });
				return;
			}
			if (++tries < POLL_TRIES) timer = setTimeout(tick, POLL_MS);
			else setSt({ kind: "slow" });
		};
		tick();
		return () => {
			stopped = true;
			clearTimeout(timer);
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
	if (st.kind === "unknown") {
		return (
			<output className="acct-muted acct-block">
				You're back from Stripe. We can't confirm the payment from here; it
				appears under Credits added once Stripe has confirmed it to us.
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
