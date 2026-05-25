import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SkeletonBar } from "@/components/console/skeleton";

export default function SubgraphsLoading() {
	return (
		<>
			<OverviewTopbar page="Subgraphs" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="index-header">
						<SkeletonBar width={120} height={14} />
					</div>
					{[0, 1, 2, 3, 4].map((i) => (
						<div
							key={i}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 12,
								padding: "16px 0",
								borderTop: "1px solid var(--border)",
							}}
						>
							<SkeletonBar width={150} height={13} />
							<SkeletonBar width={56} height={18} radius={9} />
							<SkeletonBar
								width={90}
								height={12}
								style={{ marginLeft: "auto" }}
							/>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
