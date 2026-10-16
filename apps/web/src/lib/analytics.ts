import type { PostHog } from "posthog-js";
import { redactKeys } from "./posthog-redact";

/**
 * Deferred PostHog facade. The SDK (with replay, surveys, heatmaps) is ~240 KB,
 * so it loads after hydration on an idle callback instead of blocking the
 * first-load path. Calls made before it loads are queued and replayed in order.
 *
 * Import from here, never from "posthog-js": a static import puts the SDK back
 * on the critical path.
 */

type Job = (client: PostHog) => void;
type Importer = () => Promise<{ default: PostHog }>;

let client: PostHog | null = null;
let started = false;
let queue: Job[] = [];

function run(job: Job) {
	if (client) job(client);
	else queue.push(job);
}

function scheduleIdle(callback: () => void) {
	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(callback, { timeout: 2000 });
	} else {
		setTimeout(callback, 1);
	}
}

/** Schedules the SDK import and init. Idempotent; never throws. */
export function loadAnalytics(
	importer: Importer = () => import("posthog-js"),
): void {
	if (started) return;
	const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
	const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

	if (!projectToken || !host) {
		if (process.env.NODE_ENV === "development") {
			const missingVariable = !projectToken
				? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
				: "NEXT_PUBLIC_POSTHOG_HOST";
			// A throw here is an unhandled rejection during client module evaluation,
			// which aborts Next's bootstrap and leaves the whole page unhydrated.
			// Warn loudly instead — missed analytics must not take down the site.
			console.error(
				`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
			);
		}
		return;
	}

	started = true;
	scheduleIdle(() => {
		importer()
			.then(({ default: posthog }) => {
				posthog.init(projectToken, {
					api_host: host,
					// api_host is our own first-party /ingest proxy, so the SDK can no longer
					// infer where the PostHog app lives. Without this, toolbar and replay
					// links resolve against our origin and 404.
					ui_host: "https://us.posthog.com",
					defaults: "2026-01-30",
					capture_exceptions: true,
					// A docs key is a credential: scrub any event that still carries one, and
					// never record the mint response in a replay's network log. (The key's
					// slots are also `ph-no-capture`: out of autocapture and replay.)
					before_send: (event) => (event ? redactKeys(event) : event),
					session_recording: {
						maskCapturedNetworkRequestFn: (request) =>
							request.name?.includes("/api/keys/docs") ? null : request,
					},
					debug: process.env.NODE_ENV === "development",
				});
				client = posthog;
				const pending = queue;
				queue = [];
				for (const job of pending) job(posthog);
			})
			.catch((error) => {
				if (process.env.NODE_ENV === "development") {
					console.error("PostHog failed to load", error);
				}
			});
	});
}

export function identify(id: string, properties?: Record<string, unknown>) {
	run((ph) => ph.identify(id, properties));
}

export function reset() {
	run((ph) => ph.reset());
}

export function capture(event: string, properties?: Record<string, unknown>) {
	run((ph) => ph.capture(event, properties));
}

/** Subscribes once flags resolve. The returned unsubscribe works before and after load. */
export function onFeatureFlags(callback: () => void): () => void {
	let cancelled = false;
	let unsubscribe: (() => void) | undefined;
	run((ph) => {
		if (cancelled) return;
		unsubscribe = ph.onFeatureFlags(callback);
	});
	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}

/** `undefined` until the SDK loads, which reads as "not disabled". */
export function isFeatureEnabled(flag: string): boolean | undefined {
	return client?.isFeatureEnabled(flag);
}

/** Test-only: clears module state so each test starts unloaded. */
export function resetAnalytics() {
	client = null;
	started = false;
	queue = [];
}
