import type { Command } from "commander";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import { dim, formatKeyValue, error as logError } from "../lib/output.ts";

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

export function registerBillingCommand(program: Command): void {
	const billing = program
		.command("billing")
		.description("Inspect billing state");

	billing
		.command("status")
		.description(
			"Show your current plan, Stripe subscription, trial, and discounts",
		)
		.action(async () => {
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

			const rows: [string, string][] = [];
			rows.push(["Plan", res.plan]);
			rows.push([
				"Customer",
				res.stripeCustomerId ?? dim("(none — no subscription yet)"),
			]);

			if (!res.subscription) {
				rows.push(["Subscription", dim("(none)")]);
				console.log(formatKeyValue(rows));
				return;
			}

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
					Math.round(
						(new Date(sub.trialEnd).getTime() - Date.now()) / 86_400_000,
					),
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
		});
}

function formatDate(iso: string): string {
	return new Date(iso).toISOString().slice(0, 10);
}
