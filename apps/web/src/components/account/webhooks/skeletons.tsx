"use client";

/**
 * Loading placeholders for the list and detail pages (plan 073), shaped like
 * the content they stand in for so the page doesn't jump when real data
 * lands: stats + table rows for the list, header + stats + chart + ribbon +
 * table for the detail. Every block is `.wh-skel` — one shimmering tone from
 * existing tokens, no new colors.
 */

function Skel({
	width,
	height = 14,
	style,
}: {
	width: number | string;
	height?: number;
	style?: React.CSSProperties;
}) {
	return (
		<span
			className="wh-skel"
			aria-hidden="true"
			style={{
				display: "inline-block",
				width,
				height,
				...style,
			}}
		/>
	);
}

function StatSkeleton({ label }: { label: string }) {
	return (
		<div className="acct-stat wh-skel-stats">
			<span className="acct-stat-k">{label}</span>
			<span className="acct-stat-v">
				<Skel width={48} height={20} />
			</span>
		</div>
	);
}

function TableRowSkeleton({ cols }: { cols: number }) {
	return (
		<tr className="wh-skel-row">
			{Array.from({ length: cols }).map((_, i) => (
				// Fixed column count per skeleton table; position is the identity.
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
				<td key={i}>
					<Skel width={i === 0 ? "70%" : "50%"} />
				</td>
			))}
		</tr>
	);
}

export function WebhooksListSkeleton() {
	return (
		<output aria-label="Loading webhooks" aria-busy="true">
			<div className="acct-stats">
				<StatSkeleton label="Events delivered" />
				<StatSkeleton label="Delivering" />
				<StatSkeleton label="Needs attention" />
			</div>
			<div className="wh-tbl-wrap" style={{ marginTop: 16 }}>
				<table className="wh-tbl">
					<thead>
						<tr>
							<th>Webhook</th>
							<th>Fires on</th>
							<th>Status</th>
							<th className="num">Last delivery</th>
							<th className="num">Last success</th>
						</tr>
					</thead>
					<tbody>
						{Array.from({ length: 4 }).map((_, i) => (
							// Fixed skeleton row count; position is the identity.
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
							<TableRowSkeleton key={i} cols={5} />
						))}
					</tbody>
				</table>
			</div>
		</output>
	);
}

export function WebhookDetailSkeleton({
	hideHead = false,
}: {
	/** Skip the name/pill placeholder when a real header (from the list
	 *  cache, or the webhook itself) is already rendered above this. */
	hideHead?: boolean;
} = {}) {
	return (
		<output aria-label="Loading webhook" aria-busy="true">
			{hideHead ? null : (
				<div className="wh-skel-head">
					<Skel width={220} height={26} />
					<Skel width={72} height={22} style={{ borderRadius: 999 }} />
				</div>
			)}
			<div className="acct-stats" style={{ marginTop: 14 }}>
				<StatSkeleton label="Delivered, last 7 days" />
				<StatSkeleton label="Ok, last 100 attempts" />
				<StatSkeleton label="Median response" />
				<StatSkeleton label="Failed events" />
			</div>
			<Skel
				width="100%"
				height={160}
				style={{ marginTop: 16, borderRadius: 8 }}
			/>
			<Skel
				width="100%"
				height={28}
				style={{ marginTop: 12, borderRadius: 6 }}
			/>
			<div className="wh-tbl-wrap" style={{ marginTop: 16 }}>
				<table className="wh-tbl">
					<thead>
						<tr>
							<th>Sent (UTC)</th>
							<th>Block</th>
							<th className="num">Try</th>
							<th>Response</th>
							<th className="num">Time</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{Array.from({ length: 5 }).map((_, i) => (
							// Fixed skeleton row count; position is the identity.
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
							<TableRowSkeleton key={i} cols={6} />
						))}
					</tbody>
				</table>
			</div>
		</output>
	);
}
