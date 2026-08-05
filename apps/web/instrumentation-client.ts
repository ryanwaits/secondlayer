import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!projectToken || !host) {
	if (process.env.NODE_ENV === "development") {
		const missingVariable = !projectToken
			? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
			: "NEXT_PUBLIC_POSTHOG_HOST";
		throw new Error(
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
		debug: process.env.NODE_ENV === "development",
	});
}
