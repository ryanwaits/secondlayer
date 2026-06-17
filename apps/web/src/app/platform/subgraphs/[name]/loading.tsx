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
							<SkeletonBar width={160} height={18} />
							<SkeletonBar width={28} height={14} />
							<SkeletonBar width={52} height={18} radius={5} />
						</div>
					</div>

					<div className="sg-ep">
						<SkeletonBar width="55%" height={13} />
					</div>

					<div className="sg-metrics">
						{[0, 1, 2, 3, 4].map((i) => (
							<div key={i} className="sg-metric">
								<SkeletonBar width={70} height={9} />
								<SkeletonBar width={64} height={18} style={{ marginTop: 8 }} />
								<SkeletonBar width={50} height={9} style={{ marginTop: 6 }} />
							</div>
						))}
					</div>

					<div className="sg-sec" style={{ marginTop: 28 }}>
						<div className="sg-sec-head">
							<span className="t">
								<SkeletonBar width={70} height={14} />
							</span>
						</div>
						<div className="sg-tl-grid">
							{[0, 1].map((i) => (
								<div key={i} className="sg-tl-card">
									<div className="sg-tl-header">
										<SkeletonBar width={90} height={16} />
										<SkeletonBar width={120} height={12} />
									</div>
									<div className="sg-tl-chips">
										{[0, 1, 2, 3, 4].map((j) => (
											<SkeletonBar
												key={j}
												width={58 + j * 8}
												height={22}
												radius={5}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
