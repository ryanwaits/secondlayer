import { logger } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import webpush from "web-push";
import {
	type PushKind,
	getPushPrefs,
	listSubscriptions,
	markFailed,
	markSent,
	removeSubscription,
} from "../db/queries/push.ts";
import { isPushServiceEndpoint } from "./endpoint.ts";

export interface PushPayload {
	title: string;
	body: string;
	/** Same-origin path the tap opens, e.g. "/account/webhooks/wh_123". */
	url: string;
	/** Same tag replaces an earlier notification on the device instead of stacking. */
	tag: string;
}

export type SendPushResult =
	| { skipped: "unconfigured" | "pref_off" | "no_subscriptions" }
	| { sent: number; failed: number; removed: number };

export interface PushTarget {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface SendPushDeps {
	env?: Record<string, string | undefined>;
	/** Injectable for tests; defaults to web-push's sendNotification. */
	send?: (sub: PushTarget, body: string) => Promise<void>;
	now?: Date;
}

/**
 * Sends a notification to every device the account subscribed, if the account
 * has this kind turned on. Off cleanly when the VAPID env is unset, like
 * `sendEmail` without a Resend key. Never throws for a delivery problem: a
 * sender must not fail its own job because a phone is unreachable.
 */
export async function sendPush(
	db: Kysely<Database>,
	accountId: string,
	kind: PushKind,
	payload: PushPayload,
	deps: SendPushDeps = {},
): Promise<SendPushResult> {
	const env = deps.env ?? process.env;
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	const subject = env.VAPID_SUBJECT;
	if (!publicKey || !privateKey || !subject) {
		logger.warn("VAPID keys unset — skipping push", { kind });
		return { skipped: "unconfigured" };
	}

	if (!(await getPushPrefs(db, accountId))[kind]) {
		return { skipped: "pref_off" };
	}
	const subs = await listSubscriptions(db, accountId);
	if (subs.length === 0) return { skipped: "no_subscriptions" };

	const send =
		deps.send ??
		((target: PushTarget, body: string) =>
			webpush
				.sendNotification(target, body, {
					TTL: 3600,
					vapidDetails: { subject, publicKey, privateKey },
				})
				.then(() => undefined));
	const now = deps.now ?? new Date();
	const body = JSON.stringify(payload);
	let sent = 0;
	let failed = 0;
	let removed = 0;
	for (const sub of subs) {
		// Defense in depth: never call a stored endpoint that is not a push service.
		if (!isPushServiceEndpoint(sub.endpoint)) {
			await removeSubscription(db, sub.id);
			removed++;
			continue;
		}
		try {
			await send(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth },
				},
				body,
			);
			await markSent(db, sub.id, now);
			sent++;
		} catch (error) {
			const status = (error as { statusCode?: number }).statusCode;
			if (status === 404 || status === 410) {
				await removeSubscription(db, sub.id);
				removed++;
			} else {
				await markFailed(db, sub.id);
				failed++;
				logger.warn("push.send_failed", { kind, status });
			}
		}
	}
	return { sent, failed, removed };
}
