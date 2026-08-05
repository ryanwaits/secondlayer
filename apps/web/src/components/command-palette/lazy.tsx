"use client";

import dynamic from "next/dynamic";
import posthog from "posthog-js";
import { useEffect, useState } from "react";

const CommandPalette = dynamic(
	() => import("./command-palette").then((m) => m.CommandPalette),
	{ ssr: false },
);

/**
 * The palette ships behind the `command-palette` flag so it can be pulled
 * without a deploy.
 *
 * The flag is inverted on purpose. Whenever flags fail to resolve, every flag
 * reads as off — and posthog-js empties them silently in at least two cases we
 * hit for real: it discards flags entirely for clients it decides are bots
 * (`$enabled_feature_flags: {}`, no error, no warning), and an ad-blocker
 * eating the request leaves nothing to read either.
 *
 * A positive `command-palette` flag would therefore have to treat "off" as
 * "hide", which deletes the palette for every crawler, uptime check, E2E run
 * and blocked user. Inverted, all of those degrade to the palette working, and
 * only a deliberate flip of `disable-command-palette` turns it off.
 *
 * (A genuinely disabled flag does come back as `enabled: false` — PostHog does
 * not omit it. The ambiguity is in non-resolution, not in the off state.)
 */
export function LazyCommandPalette() {
	const [hidden, setHidden] = useState(false);

	useEffect(() => {
		// Fires on the first flags response and on every later refresh.
		// Returns its own unsubscribe, which is the effect cleanup.
		return posthog.onFeatureFlags(() => {
			setHidden(posthog.isFeatureEnabled("disable-command-palette") === true);
		});
	}, []);

	if (hidden) return null;
	return <CommandPalette />;
}
