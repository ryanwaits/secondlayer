import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import Link from "next/link";
import { Suspense } from "react";
import { BillingActions } from "./billing-actions";
import s from "./billing.module.css";

type BillingStatus = {
	plan: string;
	stripeCustomerId: string | null;
	subscription: {
		id: string;
		status: string;
		tier: string | null;
		interval: string | null;
		amountCents: number | null;
		trialEnd: string | null;
		currentPeriodEnd: string | null;
		cancelAt: string | null;
		cancelAtPeriodEnd: boolean;
	} | null;
};

type LedgerState = "free" | "trialing" | "active" | "ending";

function fmtDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/** Ledger rows show only limits the API actually enforces. */
const ROWS: Record<string, [string, string][]> = {
	none: [
		["Index + Streams reads", "100 req/s"],
		["Subgraphs", "public · forward-only"],
		["Webhook subscriptions", "3"],
	],
	launch: [
		["Index + Streams reads", "250 req/s"],
		["Subgraphs", "private + genesis backfill"],
		["Webhook subscriptions", "25 + replay"],
		["Usage budgets", "monthly cap + alerts"],
	],
	scale: [
		["Index + Streams reads", "500 req/s"],
		["Subgraphs", "private + genesis backfill"],
		["Webhook subscriptions", "unlimited"],
	],
	enterprise: [
		["Index + Streams reads", "custom"],
		["Subgraphs", "private + genesis backfill"],
		["Webhook subscriptions", "unlimited"],
	],
};

const PLAN_NAME: Record<string, string> = {
	none: "Free",
	launch: "Pro",
	scale: "Scale",
	enterprise: "Enterprise",
};

export default async function BillingPage() {
	const session = await getSessionFromCookies();
	let status: BillingStatus | null = null;
	if (session) {
		try {
			status = await apiRequest<BillingStatus>("/api/billing/status", {
				sessionToken: session,
			});
		} catch {}
	}

	if (!status) {
		return (
			<>
				<OverviewTopbar
					path={<SettingsCrumb />}
					page="Billing"
					showRefresh={false}
				/>
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Unable to load billing data.</p>
					</div>
				</div>
			</>
		);
	}

	const sub = status.subscription;
	const state: LedgerState =
		sub?.status === "trialing" && !sub.cancelAtPeriodEnd
			? "trialing"
			: sub?.cancelAtPeriodEnd
				? "ending"
				: status.plan !== "none"
					? "active"
					: "free";

	const rows = ROWS[status.plan] ?? ROWS.none;
	const planName = PLAN_NAME[status.plan] ?? status.plan;
	const priceUsd =
		sub?.amountCents != null ? Math.round(sub.amountCents / 100) : 99;
	const trialEnds = fmtDate(sub?.trialEnd);
	const renews = fmtDate(sub?.currentPeriodEnd);
	const cancelDate = fmtDate(sub?.cancelAt ?? sub?.currentPeriodEnd);

	const badge =
		state === "free" ? (
			<span className={`${s.badge} ${s.badgeFree}`}>free</span>
		) : state === "trialing" ? (
			<span className={`${s.badge} ${s.badgeTrial}`}>trial</span>
		) : state === "ending" ? (
			<span className={`${s.badge} ${s.badgeEnding}`}>
				ends {cancelDate ?? "soon"}
			</span>
		) : (
			<span className={`${s.badge} ${s.badgeActive}`}>active</span>
		);

	const footMeta =
		state === "free" ? (
			<span className={s.meta}>free forever · no card on file</span>
		) : state === "trialing" ? (
			<span className={s.meta}>
				trial ends <b>{trialEnds ?? "soon"}</b> · then ${priceUsd}.00/
				{sub?.interval ?? "month"}
			</span>
		) : state === "ending" ? (
			<span className={`${s.meta} ${s.metaWarn}`}>
				cancels <b>{cancelDate ?? "at period end"}</b> · nothing further is
				charged · resume any time before then
			</span>
		) : sub ? (
			<span className={s.meta}>
				renews <b>{renews ?? "monthly"}</b> · ${priceUsd}.00/
				{sub.interval ?? "month"}
			</span>
		) : (
			<span className={s.meta}>billed directly · invoiced</span>
		);

	return (
		<>
			<OverviewTopbar
				path={<SettingsCrumb />}
				page="Billing"
				showRefresh={false}
			/>
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Billing</h1>
					<p className="settings-desc">
						Plans buy capacity and guarantees; public reads stay free either
						way. Full ladder on the{" "}
						<Link href="/site/pricing">pricing page</Link>.
					</p>

					<div className={s.sec}>
						<span>current plan</span>
					</div>
					<div className={s.ledger}>
						<div className={s.head}>
							<span className={s.name}>{planName}</span>
							{badge}
							<span className={s.price}>
								{status.plan === "enterprise" ? (
									"custom"
								) : (
									<>
										${state === "free" ? 0 : priceUsd}
										<small>/mo</small>
									</>
								)}
							</span>
						</div>
						{rows.map(([k, v]) => (
							<div className={s.erow} key={k}>
								<span>{k}</span>
								<span
									className={`${s.val} ${state === "trialing" ? s.valUp : ""}`}
								>
									{v}
								</span>
							</div>
						))}
						<div className={s.foot}>{footMeta}</div>
					</div>

					{state === "free" && (
						<>
							<div className={s.sec}>
								<span>pro unlocks</span>
							</div>
							<div className={s.delta}>
								<div className={s.erow}>
									<span>Reads</span>
									<span className={s.val}>
										100 <span className={s.arr}>→</span> <b>250 req/s</b>
									</span>
								</div>
								<div className={s.erow}>
									<span>Subgraph visibility</span>
									<span className={s.val}>
										public <span className={s.arr}>→</span> <b>+ private</b>
									</span>
								</div>
								<div className={s.erow}>
									<span>History</span>
									<span className={s.val}>
										forward-only <span className={s.arr}>→</span>{" "}
										<b>genesis backfill</b>
									</span>
								</div>
								<div className={s.erow}>
									<span>Webhook subscriptions</span>
									<span className={s.val}>
										3 <span className={s.arr}>→</span> <b>25</b>
									</span>
								</div>
							</div>
						</>
					)}

					<Suspense fallback={null}>
						<BillingActions state={state} hasSubscription={sub !== null} />
					</Suspense>

					<div className={s.sec}>
						<span>
							{state === "ending" ? "after the period ends" : "need more"}
						</span>
					</div>
					{state === "ending" ? (
						<p className={s.more}>
							You drop to Free: keyless reads, public subgraphs, forward-only
							indexing. Your data and public subgraphs are untouched.
						</p>
					) : (
						<p className={s.more}>
							Scale and Enterprise are sold directly. Email{" "}
							<a href="mailto:ryan@secondlayer.tools">ryan@secondlayer.tools</a>{" "}
							with your use case.
						</p>
					)}

					{state === "free" && (
						<div className={s.anno}>
							you may never need this page. that's the point.
						</div>
					)}
				</div>
			</div>
		</>
	);
}
