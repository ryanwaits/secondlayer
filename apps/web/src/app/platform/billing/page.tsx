import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { type BillingCaps, TIER_META, type TierMeta } from "@/lib/billing";
import { type UsageResponse, formatCents } from "@/lib/usage";
import Link from "next/link";
import { CapForm } from "./cap-form";
import { PortalLink } from "./portal-link";
import { resolvePlanFromStripe } from "./resolve-plan";
import { UpgradeButton } from "./upgrade-button";

interface Account {
	id: string;
	email: string;
	plan: string;
}

export default async function BillingPage({
	searchParams,
}: {
	searchParams: Promise<{ upgrade?: string }>;
}) {
	const session = await getSessionFromCookies();
	if (!session) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Sign in to manage your billing.</p>
					</div>
				</div>
			</>
		);
	}

	const [account, caps, usage] = await Promise.all([
		apiRequest<Account>("/api/accounts/me", { sessionToken: session }).catch(
			() => null,
		),
		apiRequest<BillingCaps>("/api/billing/caps", {
			sessionToken: session,
		}).catch(() => null),
		apiRequest<UsageResponse>("/api/accounts/usage", {
			sessionToken: session,
		}).catch(() => null),
	]);

	if (!account) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Billing</h1>
						<p className="settings-desc">Unable to load billing data.</p>
					</div>
				</div>
			</>
		);
	}

	// Fast-resolve: when the user returns from a successful Stripe
	// Checkout, the webhook may not have fired yet. Do a one-shot Stripe
	// read + plan write synchronously so the Paid view renders on first
	// paint. On any failure we fall through to whatever `account.plan`
	// currently is (webhook will catch up async).
	const sp = await searchParams;
	if (sp.upgrade === "success" && account.plan === "hobby") {
		const resolved = await resolvePlanFromStripe(session);
		if (resolved && resolved !== "hobby") {
			account.plan = resolved;
		}
	}

	const isHobby = account.plan === "hobby";

	return (
		<>
			<OverviewTopbar path="Settings" page="Billing" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Billing</h1>
					<p className="settings-desc">
						{isHobby
							? "You're on the Free plan. No payment on file — upgrade to unlock production capacity and spend controls."
							: "Manage your plan and spend controls. Payment, invoices, and cancellation live in the Stripe portal."}
					</p>

					{isHobby ? (
						<HobbyView currentPlan={account.plan} />
					) : (
						<PaidView account={account} caps={caps} usage={usage} />
					)}
				</div>
			</div>
		</>
	);
}

// ── Hobby view ─────────────────────────────────────────────────────

function HobbyView({ currentPlan }: { currentPlan: string }) {
	const tiers: TierMeta[] = [TIER_META.launch, TIER_META.grow, TIER_META.scale];

	return (
		<>
			<div className="upgrade-hero">
				<div className="hero-label">Upgrade your plan</div>
				<h2 className="hero-title">Launch brings real production capacity.</h2>
				<p className="hero-desc">
					500 compute hours a month, 50 GB storage, subgraph subscriptions with
					replay, and spend caps that never surprise you. Cancel anytime.
				</p>
			</div>

			<div className="settings-section">
				<div className="settings-section-title">Current plan</div>
				<div className="plan-card">
					<div>
						<div className="plan-card-name">
							Hobby <span className="tier-badge free">Free</span>
						</div>
						<div className="plan-card-sub">
							$0/mo · auto-pauses after 7d idle · 5 GB storage · subgraphs
						</div>
					</div>
				</div>
			</div>

			<div className="settings-section">
				<div className="settings-section-title">Compare plans</div>
				<div className="tier-grid">
					{tiers.map((t) => (
						<div
							key={t.tier}
							className={`tier-card ${t.tier === "launch" ? "featured" : ""}`}
						>
							<div className="tier-label">{t.name}</div>
							<div className="tier-price">
								${t.priceUsd}
								<span className="unit">/mo</span>
							</div>
							<div className="tier-tag">{t.tagline}</div>
							<ul>
								{t.features.map((f) => (
									<li key={f}>{f}</li>
								))}
							</ul>
							<UpgradeButton
								tier={t.tier as "launch" | "grow" | "scale"}
								label={`Upgrade to ${t.name}`}
								variant={t.tier === "launch" ? "primary" : "ghost"}
							/>
						</div>
					))}
				</div>
			</div>

			<div className="settings-divider" />

			<div
				style={{
					textAlign: "center",
					fontSize: 12,
					color: "var(--text-muted)",
				}}
			>
				Need something custom?{" "}
				<a
					href="mailto:hey@secondlayer.tools"
					style={{ color: "var(--text-main)", fontWeight: 500 }}
				>
					Talk to us about Enterprise
				</a>
			</div>

			<input type="hidden" value={currentPlan} />
		</>
	);
}

// ── Paid view ──────────────────────────────────────────────────────

function PaidView({
	account,
	caps,
	usage,
}: {
	account: Account;
	caps: BillingCaps | null;
	usage: UsageResponse | null;
}) {
	const planMeta =
		(TIER_META as Record<string, TierMeta | undefined>)[account.plan] ??
		TIER_META.launch;

	const currentCents = usage?.spend.currentCents ?? 0;
	const frozenAt = caps?.frozenAt ?? null;
	const capCents = caps?.monthlyCapCents ?? null;
	const thresholdPct = caps?.alertThresholdPct ?? 80;
	const thresholdHit = usage?.spend.thresholdHit ?? false;

	return (
		<>
			{frozenAt ? (
				<div className="callout error" role="alert">
					<svg
						className="callout-icon"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<title>Frozen</title>
						<rect x="3" y="7" width="10" height="7" rx="1" />
						<path d="M6 7V5a2 2 0 0 1 4 0v2" />
					</svg>
					<div className="callout-body">
						<div className="callout-title">Services frozen — spend cap hit</div>
						<div className="callout-sub">
							Raise the cap below or wait for the next billing cycle (cap resets
							with invoice.paid).
						</div>
					</div>
				</div>
			) : thresholdHit && capCents != null ? (
				<div className="callout warn" role="alert">
					<svg
						className="callout-icon"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<title>Threshold</title>
						<path d="M8 2l6 11H2L8 2z" />
						<path d="M8 6v4" />
						<circle cx="8" cy="12" r="0.5" fill="currentColor" />
					</svg>
					<div className="callout-body">
						<div className="callout-title">
							Projected spend at {Math.round(thresholdPct)}% of cap
						</div>
						<div className="callout-sub">
							{formatCents(usage?.spend.projectedCents ?? 0)} projected of{" "}
							{formatCents(capCents)}. Raise the cap below or upgrade your plan.
						</div>
					</div>
				</div>
			) : null}

			<div className="settings-section">
				<div className="settings-section-title">Current plan</div>
				<div className="plan-card">
					<div>
						<div className="plan-card-name">
							{planMeta.name}{" "}
							<span className="tier-badge">{planMeta.tier}</span>
						</div>
						<div className="plan-card-sub">
							${planMeta.priceUsd}/mo · manage in Stripe portal below
						</div>
					</div>
				</div>
			</div>

			<div className="settings-divider" />

			<div className="settings-section">
				<div className="settings-section-title">Spend controls</div>
				<InlineCapStrip
					capCents={capCents}
					currentCents={currentCents}
					thresholdHit={thresholdHit}
					frozen={!!frozenAt}
				/>
				<CapForm
					initialCapCents={capCents}
					initialThresholdPct={thresholdPct}
					currentSpendCents={currentCents}
				/>
			</div>

			<div className="settings-divider" />

			<div className="settings-section">
				<div className="settings-section-title">Everything else</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<PortalLink
						label="Payment methods & invoices"
						sub="Update card · download invoices · view receipts (via Stripe)"
					/>
					<PortalLink
						label="Cancel or change subscription"
						sub="Downgrade · cancel · pause · change email"
					/>
				</div>
				<div className="soon-note">
					<Link href="/usage" style={{ color: "var(--text-main)" }}>
						View usage →
					</Link>
				</div>
			</div>

			<div className="settings-divider" />

			<div style={{ fontSize: 12, color: "var(--text-muted)" }}>
				Billed as: <code>{account.email}</code>
			</div>
		</>
	);
}

// Inline (page-local) because it's slightly different from the usage page's
// CapStrip — shorter copy, no "Set cap" link (you're already on the page).
function InlineCapStrip({
	capCents,
	currentCents,
	thresholdHit,
	frozen,
}: {
	capCents: number | null;
	currentCents: number;
	thresholdHit: boolean;
	frozen: boolean;
}) {
	if (capCents == null) {
		return (
			<div className="cap-strip none" style={{ marginBottom: 16 }}>
				<div className="cap-strip-label">
					<span>No spend cap set</span>
					<span className="pct">— {formatCents(currentCents)} this period</span>
				</div>
			</div>
		);
	}
	const usedPct = Math.min((currentCents / capCents) * 100, 100);
	const fillClass = frozen ? "red" : thresholdHit ? "yellow" : "accent";
	const stripClass = frozen ? "over" : thresholdHit ? "hot" : "";

	return (
		<div className={`cap-strip ${stripClass}`} style={{ marginBottom: 16 }}>
			<div className="cap-strip-label">
				<span>This period</span>
				<span className="pct">
					{formatCents(currentCents)} / {formatCents(capCents)} ·{" "}
					{Math.round(usedPct)}%{frozen ? " 🔒" : thresholdHit ? " ⚠" : ""}
				</span>
			</div>
			<div className="cap-strip-bar">
				<div className="usage-bar">
					<div
						className={`usage-bar-fill ${fillClass}`}
						style={{ width: `${usedPct}%` }}
					/>
				</div>
			</div>
		</div>
	);
}
