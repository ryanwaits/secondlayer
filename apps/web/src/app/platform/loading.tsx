import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SkeletonBar } from "@/components/console/skeleton";

// Shared fallback for platform routes without their own loading.tsx.
// Keeps the console chrome on screen and streams in a neutral skeleton
// while the page's server-side API calls resolve.
export default function PlatformLoading() {
	return (
		<>
			<OverviewTopbar page={<SkeletonBar width={90} height={13} />} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<SkeletonBar width={140} height={14} style={{ marginBottom: 20 }} />
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						{[0, 1, 2, 3].map((i) => (
							<div
								key={i}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									padding: "14px 0",
									borderTop: "1px solid var(--border)",
								}}
							>
								<SkeletonBar width={8} height={8} radius={4} />
								<SkeletonBar width={180} height={12} />
								<SkeletonBar
									width={70}
									height={12}
									style={{ marginLeft: "auto" }}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}
