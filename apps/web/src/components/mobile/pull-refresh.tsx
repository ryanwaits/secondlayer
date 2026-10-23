"use client";

import { usePullRefresh } from "./use-pull-refresh";

/** Pull-to-refresh for a phone page: the indicator above the content. Mount it only on the phone, since a mouse drag pulls too. */
export function PullRefresh({
	onRefresh,
}: { onRefresh: () => Promise<unknown> }) {
	const { phase, offset } = usePullRefresh(onRefresh);
	if (phase === "idle") return null;
	return (
		<output className="m-ptr" style={{ height: offset || undefined }}>
			{phase === "busy"
				? "Updating…"
				: phase === "ready"
					? "Release to refresh"
					: "Pull to refresh"}
		</output>
	);
}
