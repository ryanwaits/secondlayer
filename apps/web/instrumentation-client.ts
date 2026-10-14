import posthog from "posthog-js";
import { redactKeys } from "./src/lib/posthog-redact";

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
} else {
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
}
