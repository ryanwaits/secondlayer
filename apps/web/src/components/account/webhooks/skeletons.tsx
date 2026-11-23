"use client";

import { HeatStripSkeleton } from "@/components/dashboard/charts/heat-strip";
import { Skel } from "@/components/dashboard/shell/skel";

export function WebhooksListSkeleton() {
	return (
		<output className="wl-skel" aria-label="Loading webhooks" aria-busy="true">
			{Array.from({ length: 3 }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
				<div className="wl-row" key={i}>
					<div className="wl-main">
						<Skel width="40%" height={18} />
						<Skel width="70%" />
						<Skel width="30%" height={12} />
					</div>
					{/* Always 8 days: the server render can't read the clock. During the
					23:00 UTC hour the real strip has 7, a one-row step once a day. */}
					<HeatStripSkeleton />
				</div>
			))}
		</output>
	);
}

export function WebhookDetailSkeleton({
	hideHead = false,
}: {
	hideHead?: boolean;
} = {}) {
	return (
		<output className="wd-skel" aria-label="Loading webhook" aria-busy="true">
			{hideHead ? null : <Skel width={240} height={34} />}
			<Skel width={220} height={14} />
			<div className="wd-facts">
				{Array.from({ length: 4 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
					<Skel key={i} width={104} height={50} />
				))}
			</div>
			<Skel width="100%" height={200} style={{ borderRadius: 8 }} />
			<Skel width="100%" height={160} style={{ borderRadius: 8 }} />
		</output>
	);
}
