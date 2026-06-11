import {
	OverviewTopbar,
	SettingsCrumb,
} from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import Link from "next/link";
import { Suspense } from "react";
import { BillingActions } from "./billing-actions";

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

const PLAN_COPY: Record<string, { name: string; desc: string }> = {
	none: {
		name: "Free",
		desc: "Keyless reads, public subgraphs, forward-only indexing. Free forever.",
	},
	launch: {
		name: "Pro",
		desc: "250 req/s, private subgraphs, genesis backfills, 25 webhook subscriptions.",
	},
	scale: {
		name: "Scale",
		desc: "500 req/s and heavy history — sold via contact, not self-serve.",
	},
	enterprise: {
		name: "Enterprise",
		desc: "Custom rates, dedicated capacity, SLA.",
	},
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

	const copy = PLAN_COPY[status.plan] ?? {
		name: status.plan,
		desc: "",
	};
	const sub = status.subscription;
	const renews =
		sub?.currentPeriodEnd &&
		new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});

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
						Plans buy capacity and guarantees — public reads stay free. See{" "}
						<Link href="/site/pricing">pricing</Link> for the full ladder.
					</p>

					<div className="settings-section">
						<div className="settings-section-title">Current plan</div>
						<div className="plan-card">
							<div>
								<div className="plan-card-name">
									{copy.name} <span className="tier-badge">{status.plan}</span>
									{sub?.status === "trialing" && (
										<span className="tier-badge">trial</span>
									)}
									{sub?.cancelAtPeriodEnd && (
										<span className="tier-badge">cancels at period end</span>
									)}
								</div>
								<div className="plan-card-sub">
									{copy.desc}
									{sub?.amountCents != null && (
										<>
											{" "}
											· ${(sub.amountCents / 100).toFixed(0)}/{sub.interval}
											{renews && ` · renews ${renews}`}
										</>
									)}
								</div>
							</div>
						</div>
					</div>

					<div className="settings-section">
						<Suspense fallback={null}>
							<BillingActions
								plan={status.plan}
								hasSubscription={sub !== null}
							/>
						</Suspense>
					</div>

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Need more?</div>
						<p className="settings-desc">
							Scale and Enterprise are sold directly — email{" "}
							<a href="mailto:ryan@secondlayer.tools">ryan@secondlayer.tools</a>{" "}
							with your use case.
						</p>
					</div>
				</div>
			</div>
		</>
	);
}
