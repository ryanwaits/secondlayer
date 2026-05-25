import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SkeletonBar } from "@/components/console/skeleton";

export default function SubgraphDetailLoading() {
	return (
		<>
			<OverviewTopbar
				path="Subgraphs"
				page={<SkeletonBar width={110} height={13} />}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="sg-hdr">
						<div className="sg-hdr-identity">
							<SkeletonBar width={8} height={8} radius={4} />
							<SkeletonBar width={160} height={15} />
							<SkeletonBar width={30} height={12} />
						</div>
					</div>

					<div className="sg-ep">
						<SkeletonBar width="60%" height={13} />
					</div>

					<div className="sg-cards-grid" style={{ marginTop: 20 }}>
						{[0, 1, 2, 3, 4].map((i) => (
							<div key={i} className="sg-card">
								<SkeletonBar width={80} height={10} />
								<SkeletonBar width={90} height={22} style={{ marginTop: 12 }} />
								<SkeletonBar
									width={110}
									height={10}
									style={{ marginTop: 14 }}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}
