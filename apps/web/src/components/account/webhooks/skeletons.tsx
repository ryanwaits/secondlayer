"use client";

/**
 * Loading placeholders for the list and detail pages, shaped like the content
 * they stand in for so the page doesn't jump when real data lands. Every
 * block is `.wh-skel`: one shimmering tone from existing tokens.
 */

import { Skel } from "@/components/dashboard/shell/skel";

export function WebhooksListSkeleton() {
	return (
		<output className="wl-skel" aria-label="Loading webhooks" aria-busy="true">
			{Array.from({ length: 3 }).map((_, i) => (
				// Fixed skeleton row count; position is the identity.
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
				<div className="wl-row" key={i}>
					<div className="wl-main">
						<Skel width="40%" height={18} />
						<Skel width="70%" />
						<Skel width="30%" height={12} />
					</div>
					<Skel width="100%" height={88} />
				</div>
			))}
		</output>
	);
}

export function WebhookDetailSkeleton({
	hideHead = false,
}: {
	/** Skip the name placeholder when a real header (from the list cache, or
	 *  the webhook itself) is already rendered above this. */
	hideHead?: boolean;
} = {}) {
	return (
		<output className="wd-skel" aria-label="Loading webhook" aria-busy="true">
			{hideHead ? null : <Skel width={240} height={28} />}
			<div className="wd-facts">
				{Array.from({ length: 6 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
					<Skel key={i} width={92} height={36} />
				))}
			</div>
			<Skel width="100%" height={200} style={{ borderRadius: 8 }} />
			<Skel width="100%" height={160} style={{ borderRadius: 8 }} />
		</output>
	);
}
