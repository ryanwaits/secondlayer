import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SkeletonBar } from "@/components/console/skeleton";

// Shared fallback for platform routes without their own loading.tsx, and the
// Overview dashboard. Keeps the console chrome on screen and streams in a
// skeleton matching the new overview layout (title, fleet line, ledger).
export default function PlatformLoading() {
	return (
		<>
			<OverviewTopbar page={<SkeletonBar width={90} height={13} />} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="dash-head">
						<SkeletonBar width={130} height={22} />
					</div>
					<SkeletonBar
						width={320}
						height={12}
						style={{ marginBottom: 24, display: "block" }}
					/>
					<div className="dash-sec">
						<div className="dash-sec-head">
							<span className="t">
								<SkeletonBar width={90} height={14} />
							</span>
						</div>
						<div className="dash-led">
							{[0, 1, 2, 3, 4].map((i) => (
								<div
									key={i}
									className="dash-led-row"
									style={{ cursor: "default" }}
								>
									<SkeletonBar width={150} height={13} />
									<SkeletonBar width={50} height={18} radius={5} />
									<SkeletonBar
										width={90}
										height={12}
										style={{ marginLeft: "auto" }}
									/>
									<SkeletonBar width={70} height={12} />
									<SkeletonBar width={48} height={12} />
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
