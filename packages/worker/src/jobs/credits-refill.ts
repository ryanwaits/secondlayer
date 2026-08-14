/**
 * Opt-in archive-credit auto-refill. Charges the saved card when the
 * prepaid balance drops under the account's threshold. Default is off.
 *
 * Credit lands on payment_intent.succeeded (kind=credits_refill), not here.
 * We touch refill_last_at before charging so a crash cannot double-fire
 * inside the one-hour cooldown.
 */

import {
	listDueRefills,
	touchRefill,
} from "@secondlayer/platform/db/queries/account-credits";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { getStripe } from "./stripe.ts";

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

export async function runDueRefills(): Promise<number> {
	const stripe = getStripe();
	if (!stripe) {
		logger.info("Credits refill skipped — Stripe not configured");
		return 0;
	}

	const db = getDb();
	const due = await listDueRefills(db);
	let charged = 0;

	for (const row of due) {
		await touchRefill(db, row.accountId);
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
			await stripe.paymentIntents.create({
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
			});
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
		}
	}

	return charged;
}
