"use client";

import { Meter } from "@/components/dashboard/charts/meter";
import {
	type Billing,
	type Caps,
	formatUsd,
	updateCap,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import { capDollars } from "@/lib/billing-view";
import type { RowsResponse } from "@/lib/rows";
import {
	type Burn,
	ROWS_ALLOWANCE,
	currentUtcMonth,
	formatRows,
	nextMonthLabel,
} from "@/lib/usage";
import { useState } from "react";
import { toast } from "sonner";
import { LimitsAndEmails } from "../billing/limits-and-emails";
import { AddCredits, useCheckout } from "../credits-panel";
import { CliLine } from "../webhooks/shared";

const MICROS = 1_000_000;

/** The monthly-limit line under the balance. */
export function limitLine(capUsd: number | null, spentUsd: number): string {
	if (capUsd === null) return "No monthly limit set.";
	return `Limit $${capUsd.toLocaleString("en-US")} a month, $${spentUsd.toFixed(2)} used.`;
}

/**
 * Usage and credits: rows against the free 1M, the balance and its runway,
 * and the two things you do about money here. Add credits and Set a limit
 * open their panels in place.
 */
export function UsageBlock({
	readUsage,
	billing,
	burn,
	caps,
	stopped = false,
	now = new Date(),
}: {
	readUsage: RowsResponse | null;
	billing: Billing | null;
	burn: Burn | null;
	caps: Caps | null;
	/** The hosted stack is stopped for credits. */
	stopped?: boolean;
	now?: Date;
}) {
	const co = useCheckout();
	const [panel, setPanel] = useState<"credits" | "limit" | null>(null);
	const [pendingCap, setPendingCap] = useState<number | null | undefined>();

	const used = readUsage?.allowance.usedThisMonth ?? 0;
	const free = Math.min(used, ROWS_ALLOWANCE);
	const paid = Math.max(0, used - ROWS_ALLOWANCE);
	const capUsd =
		pendingCap !== undefined
			? pendingCap
			: capDollars(caps?.monthlyCapCents ?? null);
	const spentUsd = billing
		? Number(billing.spentThisMonthUsdMicros) / MICROS
		: 0;
	const runway = daysLeftLabel(daysLeft(billing, burn));

	async function changeCap(next: number | null) {
		setPendingCap(next);
		const result = await updateCap(next == null ? null : next * 100);
		setPendingCap(undefined);
		if (!result) toast.error("Couldn't update your spend cap");
	}
	const toggle = (which: "credits" | "limit") =>
		setPanel((open) => (open === which ? null : which));

	return (
		<section id="usage" className="ov-section" aria-label="Usage and credits">
			<div className="ov-section-h">
				<h2>Usage and credits</h2>
			</div>
			<div className="ov-usage">
				<div className="ov-usage-cell">
					<span className="dash-label">Rows this month</span>
					<Meter
						used={free}
						total={ROWS_ALLOWANCE}
						over={paid}
						label="Rows delivered this month"
						left={
							paid > 0
								? `${formatRows(free)} free, ${formatRows(paid)} paid`
								: `${formatRows(used)} of ${formatRows(ROWS_ALLOWANCE)} free`
						}
					/>
					<p className="ov-usage-s">
						Resets {nextMonthLabel(currentUtcMonth(now))}. Block headers never
						count.
					</p>
				</div>
				<div className="ov-usage-cell">
					<span className="dash-label">Credits</span>
					<div className="dash-big">
						{billing ? formatUsd(billing.creditsUsdMicros) : "–"}
						{runway ? <span> {runway}</span> : null}
					</div>
					<p className="ov-usage-s">{limitLine(capUsd, spentUsd)}</p>
					<div className="ov-usage-btns">
						<button
							type="button"
							className="acct-btn solid small"
							aria-expanded={panel === "credits"}
							onClick={() => toggle("credits")}
						>
							Add credits
						</button>
						<button
							type="button"
							className="acct-btn line small"
							aria-expanded={panel === "limit"}
							onClick={() => toggle("limit")}
						>
							{capUsd === null ? "Set a limit" : "Change limit"}
						</button>
					</div>
				</div>
			</div>
			{panel === "credits" ? (
				<AddCredits co={co} billing={billing} burn={burn} stopped={stopped} />
			) : null}
			{panel === "limit" ? (
				<LimitsAndEmails
					capUsd={capUsd}
					onCapChange={changeCap}
					spentUsd={spentUsd}
				/>
			) : null}
			<CliLine label="By day" command="sl credits usage" />
			<p className="ov-usage-s">
				Add credits opens Stripe. One-time payment, nothing auto-renews.
			</p>
		</section>
	);
}
