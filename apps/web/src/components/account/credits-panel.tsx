"use client";

import { AmountPicker } from "@/components/amount-picker";
import {
	type Billing,
	PACKS_USD,
	type TopupReturn,
	ensureBilling,
	formatUsd,
	refreshBilling,
	startCheckout,
	topupLanded,
	useAccountData,
} from "@/lib/account-data";
import { ROWS_ALLOWANCE, formatRows, packDaysLabel } from "@/lib/usage";
import { useEffect, useId, useState } from "react";
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

/** The four amounts the API sells, as one radio group. `rateDayUsdMicros`
 *  and `stopped` drive each pack's "about N days at this rate" /
 *  "starts your service again" sub-label (Design step 8). */
export function CreditAmounts({
	co,
	wide = false,
	rateDayUsdMicros = 0,
	stopped = false,
}: {
	co: Checkout;
	wide?: boolean;
	rateDayUsdMicros?: number;
	stopped?: boolean;
}) {
	// Its own radio group: the page and the card can both be on screen.
	const group = useId();
	return (
		<div id={wide ? "packs" : undefined}>
			<AmountPicker
				name={group}
				legend="Amount"
				options={PACKS_USD.map((usd) => ({
					value: String(usd),
					label: `$${usd}`,
					caption: packDaysLabel(usd, rateDayUsdMicros, stopped),
				}))}
				value={String(co.amount)}
				onChange={(v) => {
					const usd = PACKS_USD.find((p) => String(p) === v);
					if (usd) co.setAmount(usd);
				}}
			/>
		</div>
	);
}

/** Go to Stripe for the picked amount. Stripe brings the reader back after. */
export function CheckoutAction({
	co,
	wide = false,
}: { co: Checkout; wide?: boolean }) {
	return (
		<>
			<div className={wide ? "acct-checkout wide" : "acct-checkout"}>
				<button
					type="button"
					className="acct-btn solid small"
					onClick={co.checkout}
					disabled={co.busy}
				>
					{co.busy ? "Opening checkout..." : `Add $${co.amount} with Stripe`}
				</button>
				<p className="acct-fine">One-time payment. Nothing auto-renews.</p>
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
	const { billing, burn } = useAccountData();
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
			footer={<CheckoutAction co={co} />}
		>
			<BalanceStats billing={billing} />
			<CreditAmounts
				co={co}
				rateDayUsdMicros={burn ? Number(burn.rateDayUsdMicros) : 0}
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
