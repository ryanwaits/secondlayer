import type { Command } from "commander";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import {
	dim,
	formatKeyValue,
	error as logError,
	output,
} from "../lib/output.ts";

interface BillingStatusResponse {
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
		discount: {
			name: string | null;
			code: string | null;
			percentOff: number | null;
			amountOff: number | null;
			duration: string;
		} | null;
	} | null;
}

async function runBillingStatus(json?: boolean): Promise<void> {
	let res: BillingStatusResponse;
	try {
		res = await httpPlatform<BillingStatusResponse>("/api/billing/status");
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
			process.exit(1);
		}
		throw err;
	}

	output({ json, data: res, human: () => renderBillingStatus(res) });
}

/** Add `<parent> billing` showing plan/subscription/trial/discounts. */
export function addBillingCommand(parent: Command): void {
	parent
		.command("billing")
		.description("Show your plan, Stripe subscription, trial, and discounts")
		.option("--json", "Output as JSON")
		.action((options: { json?: boolean }) => runBillingStatus(options.json));
}

function renderBillingStatus(res: BillingStatusResponse): void {
	// No active subscription = free open beta. Everything is unmetered
	// and there's no upgrade path yet, so keep the output reassuring
	// rather than surfacing empty Stripe fields.
	if (!res.subscription) {
		console.log(
			formatKeyValue([
				["Plan", "Free during open beta"],
				["Cost", dim("$0 — no limits, no charges")],
				["Paid plans", dim("coming after beta")],
			]),
		);
		return;
	}

	const rows: [string, string][] = [];
	rows.push(["Plan", res.plan]);
	rows.push([
		"Customer",
		res.stripeCustomerId ?? dim("(none — no subscription yet)"),
	]);

	const sub = res.subscription;
	rows.push(["Subscription", `${sub.id} (${sub.status})`]);
	if (sub.tier) rows.push(["Tier", sub.tier]);
	if (sub.amountCents !== null && sub.interval) {
		const dollars = (sub.amountCents / 100).toFixed(2);
		rows.push(["Price", `$${dollars} / ${sub.interval}`]);
	}
	if (sub.trialEnd) {
		const days = Math.max(
			0,
			Math.round((new Date(sub.trialEnd).getTime() - Date.now()) / 86_400_000),
		);
		rows.push([
			"Trial ends",
			`${formatDate(sub.trialEnd)} (${days}d remaining)`,
		]);
	}
	if (sub.currentPeriodEnd) {
		rows.push(["Renews", formatDate(sub.currentPeriodEnd)]);
	}
	if (sub.cancelAtPeriodEnd) {
		rows.push(["Cancels at period end", "yes"]);
	}
	if (sub.discount) {
		const off =
			sub.discount.percentOff !== null
				? `${sub.discount.percentOff}% off`
				: sub.discount.amountOff !== null
					? `$${(sub.discount.amountOff / 100).toFixed(2)} off`
					: "discount";
		const label = sub.discount.code
			? `${sub.discount.code} (${sub.discount.name ?? "coupon"})`
			: (sub.discount.name ?? "applied");
		rows.push(["Discount", `${label} — ${off}, ${sub.discount.duration}`]);
	}
	console.log(formatKeyValue(rows));
}

function formatDate(iso: string): string {
	return new Date(iso).toISOString().slice(0, 10);
}
