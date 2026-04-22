import { AxisCard } from "@/components/console/axis-card";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ProjectUsageTable } from "@/components/console/project-usage-table";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import {
	type UsageResponse,
	formatBytes,
	formatCents,
	formatHours,
	formatNum,
} from "@/lib/usage";
import Link from "next/link";

export default async function UsagePage() {
	const session = await getSessionFromCookies();
	let usage: UsageResponse | null = null;

	if (session) {
		try {
			usage = await apiRequest<UsageResponse>("/api/accounts/usage", {
				sessionToken: session,
			});
		} catch {}
	}

	if (!usage) {
		return (
			<>
				<OverviewTopbar path="Settings" page="Usage" showRefresh={false} />
				<div className="settings-scroll">
					<div className="settings-inner">
						<h1 className="settings-title">Usage</h1>
						<p className="settings-desc">Unable to load usage data.</p>
					</div>
				</div>
			</>
		);
	}

	const { period, plan, spend, compute, storage, aiEvals, projects } = usage;

	const periodLabel = formatPeriod(period.startIso, period.endIso);
	const capStripClass = spend.frozen
		? "over"
		: spend.thresholdHit
			? "hot"
			: spend.capCents == null
				? "none"
				: "";

	return (
		<>
			<OverviewTopbar path="Settings" page="Usage" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Usage</h1>
					<p className="settings-desc">
						Resource consumption ·{" "}
						<span className="period-chip">
							<span className="dot" />
							{periodLabel}
							{period.daysRemaining > 0
								? ` · ${period.daysRemaining} days remaining`
								: " · last day"}
						</span>
					</p>

					{spend.thresholdHit && spend.capCents != null ? (
						<div className="alert-row" role="alert">
							<svg
								className="alert-icon"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<title>Threshold warning</title>
								<path d="M8 2l6 11H2L8 2z" />
								<path d="M8 6v4" />
								<circle cx="8" cy="12" r="0.5" fill="currentColor" />
							</svg>
							<div>
								<div className="alert-title">
									Spend at{" "}
									{Math.round((spend.projectedCents / spend.capCents) * 100)}%
									of cap
								</div>
								<div className="alert-body">
									{formatCents(spend.projectedCents)} projected of{" "}
									{formatCents(spend.capCents)} — {period.daysRemaining} day
									{period.daysRemaining === 1 ? "" : "s"} to go.{" "}
									<Link
										href="/platform/billing"
										style={{ color: "var(--text-main)", fontWeight: 500 }}
									>
										Raise cap or upgrade →
									</Link>
								</div>
							</div>
						</div>
					) : null}

					<div className="axis-grid">
						<AxisCard
							label="Compute"
							value={formatHours(compute.usedHours)}
							unit="h"
							of={
								Number.isFinite(compute.allowanceHours)
									? `of ${formatNum(compute.allowanceHours)} h / mo`
									: plan.tier === "hobby"
										? "active · auto-pauses after 7d idle"
										: "unmetered"
							}
							pct={compute.pct}
							sparkData={compute.sparkline}
							color="accent"
							hidePct={!Number.isFinite(compute.allowanceHours)}
						/>
						<AxisCard
							label="Storage"
							value={formatBytes(storage.usedBytes)}
							of={
								Number.isFinite(storage.allowanceBytes)
									? `of ${formatBytes(storage.allowanceBytes)}`
									: "unmetered"
							}
							pct={storage.pct}
							sparkData={storage.sparkline}
							color="teal"
							hidePct={!Number.isFinite(storage.allowanceBytes)}
						/>
						<AxisCard
							label="AI evals"
							value={formatNum(aiEvals.todayCount)}
							unit="today"
							of={
								Number.isFinite(aiEvals.dailyCap)
									? `of ${formatNum(aiEvals.dailyCap)} / day · resets 00:00 UTC`
									: "unmetered"
							}
							pct={aiEvals.pct}
							sparkData={aiEvals.sparkline}
							color="accent"
							hidePct={!Number.isFinite(aiEvals.dailyCap)}
						/>
					</div>

					<CapStrip
						currentCents={spend.currentCents}
						projectedCents={spend.projectedCents}
						capCents={spend.capCents}
						thresholdHit={spend.thresholdHit}
						frozen={spend.frozen}
						stripClass={capStripClass}
					/>

					<div className="settings-section">
						<div className="settings-section-title">
							Projects ({projects.length})
						</div>
						<ProjectUsageTable projects={projects} />
					</div>

					<div className="settings-divider" />

					<div className="settings-section">
						<div className="settings-section-title">Plan</div>
						<div className="plan-card">
							<div>
								<div className="plan-card-name">
									{plan.name} <span className="tier-badge">{plan.tier}</span>
								</div>
								<div className="plan-card-sub">
									{plan.basePriceUsd > 0
										? `$${plan.basePriceUsd}/mo · `
										: "Free · "}
									{Number.isFinite(compute.allowanceHours)
										? `${formatNum(compute.allowanceHours)} h compute, `
										: "unlimited compute, "}
									{Number.isFinite(storage.allowanceBytes)
										? `${formatBytes(storage.allowanceBytes)} storage, `
										: "unlimited storage, "}
									{Number.isFinite(aiEvals.dailyCap)
										? `${formatNum(aiEvals.dailyCap)} AI/day`
										: "unlimited AI"}
								</div>
							</div>
							<Link
								href="/platform/billing"
								className="settings-btn ghost"
								style={{ textDecoration: "none" }}
							>
								Manage plan
							</Link>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

// ── Inlined subcomponents ──────────────────────────────────────────

function CapStrip({
	currentCents,
	projectedCents,
	capCents,
	thresholdHit,
	frozen,
	stripClass,
}: {
	currentCents: number;
	projectedCents: number;
	capCents: number | null;
	thresholdHit: boolean;
	frozen: boolean;
	stripClass: string;
}) {
	if (capCents == null) {
		return (
			<div className="cap-strip none">
				<div className="cap-strip-label">
					<span>No spend cap set</span>
					<span className="pct">— {formatCents(currentCents)} this period</span>
				</div>
				<Link href="/platform/billing" className="cap-strip-action">
					Set cap →
				</Link>
			</div>
		);
	}

	const useProjected = projectedCents > currentCents;
	const displayCents = useProjected ? projectedCents : currentCents;
	const usedPct = Math.min((displayCents / capCents) * 100, 100);
	const label = frozen
		? "Frozen at cap"
		: useProjected
			? "Projected this period"
			: "Spend this period";

	const fillClass = frozen ? "red" : thresholdHit ? "yellow" : "accent";

	return (
		<div className={`cap-strip ${stripClass}`}>
			<div className="cap-strip-label">
				<span>{label}</span>
				<span className="pct">
					{formatCents(displayCents)} / {formatCents(capCents)} ·{" "}
					{Math.round(usedPct)}%{thresholdHit ? " ⚠" : ""}
					{frozen ? " 🔒" : ""}
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
			<Link href="/platform/billing" className="cap-strip-action">
				{frozen ? "Unfreeze →" : "Change →"}
			</Link>
		</div>
	);
}

function formatPeriod(startIso: string, endIso: string): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	const m = (d: Date) =>
		d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
	const day = (d: Date) => d.getUTCDate();
	return `${m(start)} ${day(start)} – ${m(end)} ${day(end)}`;
}
