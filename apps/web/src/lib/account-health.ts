import { countByDisplayStatus } from "@/components/account/webhooks/shared";
import type { WebhookSummary } from "@secondlayer/sdk";
import type { Billing, Caps } from "./account-data";
import { isStopped, stackStatus } from "./stack-status";
import {
	type Burn,
	type HostedStack,
	balanceLevelFor,
	runwayDays,
} from "./usage";

/**
 * The one definition of "this account needs attention". The Overview page,
 * the nav chip and its menu all read it, so they never disagree. A new kind
 * of problem goes here and shows up everywhere.
 */

export type ProblemKind =
	| "low_balance"
	| "cap_frozen"
	| "stack_stopped"
	| "webhook_failing";

export type Problem = {
	kind: ProblemKind;
	label: string;
	/** Where the fix lives. */
	href: string;
	/** Button text for that fix. */
	action: string;
};

export type HealthInput = {
	billing: Billing | null;
	burn: Burn | null;
	service: HostedStack | null;
	caps: Caps | null;
	/** `null` until the webhooks list has loaded. */
	webhooks: readonly WebhookSummary[] | null;
};

/**
 * Days of balance left at the trailing-24h burn. `null` while either input
 * is unknown, `Infinity` when nothing is burning.
 */
export function daysLeft(
	billing: Billing | null,
	burn: Burn | null,
): number | null {
	if (!billing || !burn) return null;
	return runwayDays(
		Number(billing.creditsUsdMicros),
		Number(burn.rateDayUsdMicros),
	);
}

/** "about 86 days" / "under a day"; `null` when unknown or nothing burns. */
export function daysLeftLabel(days: number | null): string | null {
	if (days === null || !Number.isFinite(days)) return null;
	if (days < 1) return "under a day";
	const n = Math.floor(days);
	return `about ${n} day${n === 1 ? "" : "s"}`;
}

export function accountProblems(input: HealthInput): Problem[] {
	const { billing, burn, service, caps, webhooks } = input;
	const problems: Problem[] = [];

	const balance = billing ? Number(billing.creditsUsdMicros) : null;
	// "crit" is the balance's one threshold (2 days of burn or less), shared
	// with the billing page and the balance emails.
	const level = balanceLevelFor(billing, burn, service);
	const stack = stackStatus({
		service: service?.state ?? null,
		read: null,
		creditsUsdMicros: billing?.creditsUsdMicros ?? null,
	});
	const stopped = isStopped(stack);
	// $0 only matters once something needs credits: a hosted stack, or spend.
	// A new account on the free rows has nothing to pay for yet.
	const needsCredits =
		(service !== null && service.state !== "none") ||
		(burn !== null && Number(burn.rateDayUsdMicros) > 0);
	const broke = balance !== null && balance <= 0 && needsCredits;

	if (broke) {
		problems.push({
			kind: "low_balance",
			label: stopped
				? "Balance is $0 and your hosted stack is stopped"
				: "Balance is $0",
			href: "/account/credits",
			action: "Add credits",
		});
	} else if (level === "crit") {
		problems.push({
			kind: "low_balance",
			label: "2 days of credit or less left",
			href: "/account/credits",
			action: "Add credits",
		});
	}

	if (caps?.frozenAt) {
		problems.push({
			kind: "cap_frozen",
			label: "Your monthly spend cap paused reads past the free rows",
			href: "/account/credits#cap",
			action: "Change cap",
		});
	}

	// A $0 balance already explains a stopped stack; don't count it twice.
	if (stopped && !broke) {
		problems.push({
			kind: "stack_stopped",
			label: "Your hosted stack is stopped",
			href: "/account/credits",
			action: "See why",
		});
	}

	const failing = webhooks ? countByDisplayStatus(webhooks, "error") : 0;
	if (failing > 0) {
		problems.push({
			kind: "webhook_failing",
			label:
				failing === 1
					? "1 webhook needs attention"
					: `${failing} webhooks need attention`,
			href: "/account/webhooks",
			action: "Review",
		});
	}

	return problems;
}
