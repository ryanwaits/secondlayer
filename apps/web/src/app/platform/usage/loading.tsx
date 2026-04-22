import { OverviewTopbar } from "@/components/console/overview-topbar";

export default function UsageLoading() {
	return (
		<>
			<OverviewTopbar path="Settings" page="Usage" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Usage</h1>
					<p className="settings-desc" style={{ opacity: 0.4 }}>
						Loading…
					</p>

					<div className="axis-grid">
						<SkeletonAxisCard />
						<SkeletonAxisCard />
						<SkeletonAxisCard />
					</div>

					<div
						className="cap-strip none"
						style={{ opacity: 0.4 }}
						aria-busy="true"
					>
						<div className="cap-strip-label">
							<span
								style={{
									background: "var(--code-bg)",
									width: 200,
									height: 12,
									borderRadius: 3,
								}}
							/>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

function SkeletonAxisCard() {
	const bar = {
		background: "var(--code-bg)",
		borderRadius: 3,
		display: "inline-block",
	} as const;
	return (
		<div className="axis-card" aria-busy="true">
			<div className="axis-head">
				<div className="axis-label" style={{ ...bar, width: 60, height: 10 }} />
				<div className="axis-pct" style={{ ...bar, width: 30, height: 10 }} />
			</div>
			<div style={{ ...bar, width: 90, height: 22, marginTop: 4 }} />
			<div style={{ ...bar, width: 110, height: 10, marginTop: 10 }} />
			<div
				style={{
					...bar,
					width: "100%",
					height: 24,
					marginTop: 16,
				}}
			/>
		</div>
	);
}
