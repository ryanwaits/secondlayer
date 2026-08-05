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
 * The flag is inverted on purpose. PostHog omits a disabled flag from the
 * client payload entirely rather than returning it as false, so "rolled out to
 * 0%", "flag deleted", "wrong evaluation_runtime" and "request blocked by an
 * ad-blocker" all arrive identically: absent. A positive `command-palette` flag
 * would therefore have to read absence as "hide", handing four unrelated
 * failure modes the power to delete a working feature.
 *
 * Inverted, absence means "don't hide" — so every one of those degrades to the
 * palette working, and only a deliberate flip of `disable-command-palette`
 * turns it off.
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
