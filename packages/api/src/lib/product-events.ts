/**
 * Funnel events, sent to PostHog from the server, where each fact happens:
 *
 *   signin_link_sent  { new_email, from }   routes/auth.ts POST /magic-link
 *   account_created   { via }               verify, guest checkout, Sentinel resolve
 *   api_key_created   { product }           POST /api/keys, Sentinel POST /keys
 *   docs_key_minted   { signed_in }         auth/routes.ts POST /docs, routes/public-docs-key.ts
 *   first_request     { source, ghost }     lib/read-credits.ts, the account's first metered read
 *
 * `distinct_id` is the account id when there is one. Before there is (a new
 * email asking for a link, a signed-out docs key), it is the browser's PostHog
 * id when the page sent one, so the event joins that visitor's pageviews; else
 * an id with no person profile (the ghost's for a docs key, else a throwaway),
 * so the event still counts. A ghost's events never make a person.
 *
 * The property types are closed on purpose: no email, key or IP ever goes out.
 * `$geoip_disable` keeps PostHog from placing the person at our API host.
 *
 * Fire-and-forget: never awaited, never throws, never slows the request. A
 * no-op unless `POSTHOG_PROJECT_TOKEN` is set (self-host and tests leave it
 * unset).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

const POSTHOG_CAPTURE = "https://us.i.posthog.com/capture/";
const SEND_TIMEOUT_MS = 5_000;

export type ProductEvent =
	| {
			event: "signin_link_sent";
			properties: { new_email: boolean; from: SigninFrom };
	  }
	| {
			event: "account_created";
			properties: { via: "signin" | "checkout" | "sentinel" };
	  }
	| { event: "api_key_created"; properties: { product: string } }
	| { event: "docs_key_minted"; properties: { signed_in: boolean } }
	| { event: "first_request"; properties: { source: string; ghost: boolean } };

/** Where a sign-in link was asked for: the sign-in page, or the docs
 *  "Make a lasting key" panel. Analytics only, so anything else reads as the
 *  sign-in page rather than failing the request. */
export const SigninFromSchema = z
	.enum(["signin", "lasting_key"])
	.catch("signin");
type SigninFrom = z.infer<typeof SigninFromSchema>;

/** The browser's PostHog distinct id, as a request body may carry it.
 *  Analytics only, so a bad value reads as none. */
export const BrowserDistinctIdSchema = z
	.string()
	.min(1)
	.max(200)
	.optional()
	.catch(undefined);

/** Who an event belongs to. `anonymous` sends it without a person profile. */
export type EventSubject = { distinctId: string; anonymous?: boolean };

/** The subject for a fact with no person account yet: the browser's id, else
 *  `fallbackId` (or a throwaway one) with no person profile. */
export function visitorSubject(
	browserDistinctId: string | undefined,
	fallbackId: string = randomUUID(),
): EventSubject {
	return browserDistinctId
		? { distinctId: browserDistinctId }
		: { distinctId: fallbackId, anonymous: true };
}

export function productEventsEnabled(): boolean {
	return Boolean(process.env.POSTHOG_PROJECT_TOKEN);
}

export function trackProductEvent(
	subject: EventSubject,
	{ event, properties }: ProductEvent,
): void {
	const token = process.env.POSTHOG_PROJECT_TOKEN;
	if (!token) return;
	try {
		fetch(POSTHOG_CAPTURE, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				api_key: token,
				event,
				distinct_id: subject.distinctId,
				timestamp: new Date().toISOString(),
				properties: {
					...properties,
					$lib: "secondlayer-api",
					$geoip_disable: true,
					...(subject.anonymous ? { $process_person_profile: false } : {}),
				},
			}),
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
		}).catch(() => {});
	} catch {
		// Analytics never fails a request.
	}
}
