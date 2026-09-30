/**
 * Opt-in archive-credit auto-refill. Charges the saved card when the
 * prepaid balance drops under the account's threshold. Default is off.
 *
 * Credit lands on payment_intent.succeeded (kind=credits_refill), not here.
 * We touch refill_last_at before charging so a crash cannot double-fire
 * inside the one-hour cooldown, and key the Stripe charge on that attempt
 * (`refill:<accountId>:<refill_last_at>`) so a retried call can't charge twice.
 *
 * A declined / failed / authentication-required charge turns auto top-up OFF
 * for the account, sends the owner one email, and is never retried: the owner
 * turns it back on themselves. Transient Stripe errors (network, 5xx, rate
 * limit) aren't a failed charge; those keep the setting and wait for the
 * next cooldown window.
 */

import {
	listDueRefills,
	setCreditRefill,
	touchRefill,
} from "@secondlayer/platform/db/queries/account-credits";
import { getAccountById } from "@secondlayer/platform/db/queries/accounts";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { renderEmail, sendEmail } from "@secondlayer/shared/email";
import { getInstanceMode } from "@secondlayer/shared/mode";
import type Stripe from "stripe";
import { getStripe } from "./stripe.ts";

const CREDITS_LINK = "https://secondlayer.tools/account/credits";

const INTERVAL_MS = 15 * 60 * 1000;

export function startCreditsRefillCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Credits refill cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await runDueRefills();
		} catch (err) {
			logger.error("Credits refill cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 2 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);
	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

export type RefillDeps = {
	stripe?: Stripe | null;
	sendEmail?: typeof sendEmail;
};

/** Stripe errors that mean "no charge happened, try again later". */
function isTransientStripeError(err: unknown): boolean {
	const type = (err as { type?: string } | null)?.type;
	return (
		type === "StripeConnectionError" ||
		type === "StripeAPIError" ||
		type === "StripeRateLimitError"
	);
}

function failureReason(err: unknown): "declined" | "authentication" {
	const e = err as { code?: string; decline_code?: string } | null;
	return e?.code === "authentication_required" ||
		e?.decline_code === "authentication_required"
		? "authentication"
		: "declined";
}

async function turnOffRefill(
	accountId: string,
	reason: "declined" | "authentication",
	send: typeof sendEmail,
): Promise<void> {
	const db = getDb();
	await setCreditRefill(db, accountId, { belowUsdMicros: null, packUsd: null });
	const account = await getAccountById(db, accountId);
	if (!account?.email) return; // ghost account: nothing to email
	const subject =
		reason === "authentication"
			? "Auto top-up is off: your card needs authentication"
			: "Auto top-up is off: your card was declined";
	const { html, text } = renderEmail({
		heading: subject,
		paragraphs: [
			reason === "authentication"
				? "We tried to add credits to your balance, but your bank asked for authentication we can't complete automatically."
				: "We tried to add credits to your balance, but your card was declined.",
			"We turned auto top-up off and won't try again. Add credits or update your card, then turn auto top-up back on.",
		],
		cta: { label: "Add credits", url: CREDITS_LINK },
	});
	try {
		await send({ to: account.email, subject, html, text });
	} catch (err) {
		logger.error("Credits refill failure email not sent", {
			accountId,
			error: getErrorMessage(err),
		});
	}
}

export async function runDueRefills(deps: RefillDeps = {}): Promise<number> {
	const stripe = deps.stripe !== undefined ? deps.stripe : getStripe();
	if (!stripe) {
		logger.info("Credits refill skipped — Stripe not configured");
		return 0;
	}

	const db = getDb();
	const due = await listDueRefills(db);
	let charged = 0;

	for (const row of due) {
		const attemptAt = new Date();
		let charging = false; // only a failed CHARGE turns auto top-up off
		await touchRefill(db, row.accountId, attemptAt);
		try {
			const customer = await stripe.customers.retrieve(row.stripeCustomerId);
			if ("deleted" in customer && customer.deleted) {
				logger.warn("Credits refill skipped — customer deleted", {
					accountId: row.accountId,
				});
				continue;
			}
			const defaultPm =
				typeof customer.invoice_settings?.default_payment_method === "string"
					? customer.invoice_settings.default_payment_method
					: customer.invoice_settings?.default_payment_method?.id;
			const paymentMethod =
				defaultPm ??
				(
					await stripe.paymentMethods.list({
						customer: row.stripeCustomerId,
						type: "card",
						limit: 1,
					})
				).data[0]?.id;
			if (!paymentMethod) {
				logger.warn("Credits refill skipped — no saved card", {
					accountId: row.accountId,
				});
				continue;
			}
			charging = true;
			const intent = await stripe.paymentIntents.create(
				{
					amount: row.packUsd * 100,
					currency: "usd",
					customer: row.stripeCustomerId,
					payment_method: paymentMethod,
					off_session: true,
					confirm: true,
					metadata: {
						kind: "credits_refill",
						secondlayer_account_id: row.accountId,
					},
				},
				{
					idempotencyKey: `refill:${row.accountId}:${attemptAt.toISOString()}`,
				},
			);
			if (intent.status === "requires_payment_method") {
				throw Object.assign(new Error("card_declined"), {
					code: "card_declined",
				});
			}
			if (intent.status === "requires_action") {
				throw Object.assign(new Error("authentication_required"), {
					code: "authentication_required",
				});
			}
			charged += 1;
			logger.info("Credits refill payment created", {
				accountId: row.accountId,
				packUsd: row.packUsd,
				balanceUsdMicros: row.balanceUsdMicros.toString(),
			});
		} catch (err) {
			logger.error("Credits refill charge failed", {
				accountId: row.accountId,
				error: getErrorMessage(err),
			});
			if (!charging || isTransientStripeError(err)) continue;
			await turnOffRefill(
				row.accountId,
				failureReason(err),
				deps.sendEmail ?? sendEmail,
			);
		}
	}

	return charged;
}
