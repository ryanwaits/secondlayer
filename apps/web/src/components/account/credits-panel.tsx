"use client";

import {
	type BalanceAlerts,
	type Billing,
	PACKS_USD,
	type PackUsd,
	type TopupReturn,
	formatUsd,
	refreshAlerts,
	refreshBilling,
	refreshUsage,
	startCheckout,
	topupLanded,
	updateAlerts,
	useAccountData,
} from "@/lib/account-data";
import {
	type BalanceLevel,
	type DeliveryService,
	ROWS_ALLOWANCE,
	type ServiceState,
	balanceLevel,
	currentUtcMonth,
	formatRows,
	monthParam,
	nextMonthLabel,
	packDaysLabel,
	runsOutDate,
	runwayDays,
} from "@/lib/usage";
import { poll } from "@/lib/webhooks-store";
import NumberFlow from "@number-flow/react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { DeliveryServiceCard } from "./credits/delivery-service-card";
import { SpendCard } from "./credits/spend-card";
import { FloatingCard } from "./floating-card";
import { UsageSection, useUsageMonth } from "./usage-panel";

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
			Every account gets{" "}
			<strong>{formatRows(ROWS_ALLOWANCE)} rows free each month</strong>, live
			or history. After that, <strong>$5 per 1M rows</strong>, then $2 per 1M
			past $50 in a month. Webhooks: <strong>$10 per 1M events</strong> (retries
			free), plus the delivery service's memory at $0.028 per GB-hour,{" "}
			<strong>0.5 GB minimum</strong> (about $10/mo while it runs). Self-hosted
			instances are never metered.
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

/** The four amounts the API sells, as one radio group. `rateDayUsdMicros`
 *  and `stopped` drive each pack's "about N days at this rate" /
 *  "starts your service again" sub-label (Design step 8). */
function AmountPicker({
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
		<fieldset
			id={wide ? "packs" : undefined}
			className={wide ? "acct-packs wide" : "acct-packs"}
		>
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
					<span className="acct-pack-main">
						<span className="acct-pack-amount">${usd}</span>
						<span className="acct-pack-dot" aria-hidden="true" />
					</span>
					<span className="acct-pack-days">
						{packDaysLabel(usd, rateDayUsdMicros, stopped)}
					</span>
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
	const { billing, burn } = useAccountData();
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
			<AmountPicker
				co={co}
				rateDayUsdMicros={burn ? Number(burn.rateDayUsdMicros) : 0}
			/>
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

/** The level banner: hidden at `ok`, otherwise the exact copy for `low` /
 *  `crit` / `stopped` (Design step 5.2). Replaces the old
 *  `OutOfCreditsBanner`, whose 402 wording lives on inside the `stopped`
 *  case below. */
function LevelBanner({
	level,
	runway,
	rateDayUsdMicros,
	now,
	service,
}: {
	level: BalanceLevel;
	runway: number;
	rateDayUsdMicros: number;
	now: Date;
	service: DeliveryService;
}) {
	if (level === "ok") return null;

	let title: string;
	let body: string;
	if (level === "stopped") {
		const stoppedDate = service.lastChargedAt
			? runsOutDate(new Date(service.lastChargedAt), 0)
			: null;
		title = stoppedDate
			? `Your delivery service stopped on ${stoppedDate}`
			: "Your delivery service stopped";
		body = `Your balance reached $0. Webhooks aren't delivering, and hosted reads past the free ${formatRows(ROWS_ALLOWANCE)} rows answer 402 insufficient_credits until you top up; free rows return on ${nextMonthLabel(currentUtcMonth(now))}. Add credits and the service starts again within 5 minutes.`;
	} else if (level === "crit") {
		title = "Under 2 days of credit left";
		body = `At ${formatUsd(rateDayUsdMicros)}/day your balance runs out ${runsOutDate(now, runway)}. Your delivery service stops then, and webhooks stop delivering until you add credits.`;
	} else {
		title = `About ${Math.floor(runway)} days of credit left`;
		body = `At ${formatUsd(rateDayUsdMicros)}/day your balance runs out around ${runsOutDate(now, runway)}. Add credits before then to keep webhooks delivering.`;
	}

	return (
		<output className={`use-banner ${level}`}>
			<div>
				<p className="use-banner-t">{title}</p>
				<p className="use-banner-l">{body}</p>
			</div>
			<button
				type="button"
				className="acct-btn"
				onClick={() =>
					document
						.getElementById("packs")
						?.scrollIntoView({ behavior: "smooth" })
				}
			>
				Add credits
			</button>
		</output>
	);
}

/** Balance + level pill + runway bar, Burning now, Runs out (Design step
 *  5.3). */
function RunwayRow({
	balanceUsdMicros,
	level,
	runway,
	rateDayUsdMicros,
	now,
	service,
}: {
	balanceUsdMicros: number;
	level: BalanceLevel;
	runway: number;
	rateDayUsdMicros: number;
	now: Date;
	service: DeliveryService;
}) {
	const finiteRunway = Number.isFinite(runway);
	const barPct = finiteRunway
		? Math.min(100, (Math.min(runway, 30) / 30) * 100)
		: 100;
	const pillLabel =
		level === "stopped"
			? "Service stopped"
			: !finiteRunway
				? "No ongoing charges"
				: runway >= 1
					? `About ${Math.floor(runway)} days left`
					: "Under a day left";
	const runsOut =
		level === "stopped"
			? service.lastChargedAt
				? runsOutDate(new Date(service.lastChargedAt), 0)
				: "No ongoing charges"
			: !finiteRunway
				? "No ongoing charges"
				: runsOutDate(now, runway);
	const runsOutSub =
		level === "stopped"
			? "balance reached $0"
			: finiteRunway
				? "at today's rate"
				: "";
	const rateSub =
		rateDayUsdMicros > 0
			? `${formatUsd(rateDayUsdMicros / 24)}/hour`
			: service.state === "running"
				? "No charges in the last 24 hours"
				: "Nothing runs while stopped";

	return (
		<section className="use-runway" aria-label="Balance and runway">
			<div>
				<span className="use-rk">Balance</span>
				<span className="use-rv">
					<NumberFlow
						value={balanceUsdMicros / 1_000_000}
						format={{ style: "currency", currency: "USD" }}
					/>
				</span>
				<span className={`use-pill ${level}`}>{pillLabel}</span>
				<div
					className={`use-runbar ${level}`}
					role="img"
					aria-label={
						level === "stopped"
							? "No runway"
							: `${Math.floor(finiteRunway ? runway : 30)} of 30 days of runway`
					}
				>
					<i style={{ width: `${barPct.toFixed(1)}%` }} />
				</div>
			</div>
			<div>
				<span className="use-rk">Burning now</span>
				<span className="use-rv">
					<NumberFlow
						value={rateDayUsdMicros / 1_000_000}
						format={{ style: "currency", currency: "USD" }}
					/>{" "}
					<small>/day</small>
				</span>
				<span className="use-rs">{rateSub}</span>
			</div>
			<div>
				<span className="use-rk">Runs out</span>
				<span className="use-rv">{runsOut}</span>
				{runsOutSub ? <span className="use-rs">{runsOutSub}</span> : null}
			</div>
		</section>
	);
}

function AlertSwitch({
	id,
	checked,
	onChange,
	title,
	sub,
}: {
	id: string;
	checked: boolean;
	onChange: () => void;
	title: string;
	sub: string;
}) {
	return (
		<div className="use-alert-row">
			<label htmlFor={id}>
				<span className="t">{title}</span>
				<span className="s">{sub}</span>
			</label>
			<span className="use-switch">
				<input type="checkbox" id={id} checked={checked} onChange={onChange} />
				<span />
			</span>
		</div>
	);
}

const DEFAULT_ALERTS: BalanceAlerts = { notify7d: true, notify2d: true };

/** Two switches, bound to `GET/PUT /api/billing/alerts`. Optimistic: the
 *  switch flips immediately, then reverts with a Sonner toast if the write
 *  fails (Design step 5.7). */
function BalanceAlertsSection() {
	const { alerts } = useAccountData();
	useEffect(() => {
		refreshAlerts();
	}, []);
	const [pending, setPending] = useState<BalanceAlerts | null>(null);
	const current = pending ?? alerts ?? DEFAULT_ALERTS;

	async function toggle(key: keyof BalanceAlerts) {
		const next = { ...current, [key]: !current[key] };
		setPending(next);
		const result = await updateAlerts({ [key]: next[key] });
		setPending(null);
		if (!result) toast.error("Couldn't update that alert");
	}

	return (
		<>
			<h2 className="acct-h2">Balance alerts</h2>
			<div className="use-alerts">
				<AlertSwitch
					id="al-7"
					checked={current.notify7d}
					onChange={() => toggle("notify7d")}
					title="Email me at 7 days left"
					sub="Based on the last 24 hours of spend"
				/>
				<AlertSwitch
					id="al-2"
					checked={current.notify2d}
					onChange={() => toggle("notify2d")}
					title="Email me at 2 days left"
					sub="And again if the service stops"
				/>
			</div>
		</>
	);
}

/** The credits flow on /account/credits, including the way back from Stripe. */
export function CreditsSection({ ret }: { ret: TopupReturn | null }) {
	const { billing, burn, service } = useAccountData();
	const st = useTopupReturn(ret);
	const co = useCheckout();
	const monthState = useUsageMonth();

	useEffect(() => {
		refreshBilling();
	}, []);

	// Every 60s while the tab is visible, refresh the current month's usage —
	// this is also how `burn`/`service` (always "now") stay live regardless
	// of which month the switcher above is browsing.
	useEffect(() => {
		return poll(async () => {
			await refreshUsage(monthParam(currentUtcMonth()));
			return {};
		}, 60_000);
	}, []);

	const now = new Date();
	const balanceUsdMicros = billing ? Number(billing.creditsUsdMicros) : 0;
	const rateDayUsdMicros = burn ? Number(burn.rateDayUsdMicros) : 0;
	const serviceState: ServiceState = service?.state ?? "none";
	const runway = runwayDays(balanceUsdMicros, rateDayUsdMicros);
	const level = balanceLevel({
		serviceState,
		balanceUsdMicros,
		runwayDays: runway,
	});
	const ready = billing !== null && burn !== null && service !== null;

	return (
		<>
			{st ? <ReturnNotice st={st} billing={billing} /> : null}
			{st?.kind !== "landed" && ready && service ? (
				<>
					<LevelBanner
						level={level}
						runway={runway}
						rateDayUsdMicros={rateDayUsdMicros}
						now={now}
						service={service}
					/>
					<RunwayRow
						balanceUsdMicros={balanceUsdMicros}
						level={level}
						runway={runway}
						rateDayUsdMicros={rateDayUsdMicros}
						now={now}
						service={service}
					/>
				</>
			) : null}
			<SpendCard
				month={monthState.month}
				rows={monthState.rows}
				daily={monthState.daily}
				rateDayUsdMicros={rateDayUsdMicros}
				serviceState={serviceState}
			/>
			{service ? <DeliveryServiceCard service={service} /> : null}
			<UsageSection monthState={monthState} service={service} />
			<BalanceAlertsSection />
			<h2 className="acct-h2">Add credits</h2>
			<AmountPicker
				co={co}
				wide
				rateDayUsdMicros={rateDayUsdMicros}
				stopped={level === "stopped"}
			/>
			<CheckoutAction co={co} wide />
			<PricingNote />
		</>
	);
}
