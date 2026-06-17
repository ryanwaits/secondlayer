import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SkeletonBar } from "@/components/console/skeleton";

export default function SubgraphsLoading() {
	return (
		<>
			<OverviewTopbar page="Subgraphs" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="sg-index">
						<div className="sg-index-head">
							<SkeletonBar width={140} height={20} />
						</div>
						<div className="sg-toolbar">
							<SkeletonBar width={240} height={28} radius={7} />
							<SkeletonBar
								width={210}
								height={28}
								radius={7}
								style={{ marginLeft: "auto" }}
							/>
							<SkeletonBar width={62} height={28} radius={7} />
						</div>
						<table className="sg-ledger">
							<tbody>
								{[0, 1, 2, 3, 4].map((i) => (
									<tr key={i}>
										<td>
											<SkeletonBar width={150} height={13} />
										</td>
										<td>
											<SkeletonBar width={52} height={18} radius={5} />
										</td>
										<td className="num">
											<SkeletonBar width={24} height={12} />
										</td>
										<td className="num">
											<SkeletonBar width={80} height={12} />
										</td>
										<td className="num">
											<SkeletonBar width={70} height={12} />
										</td>
										<td>
											<SkeletonBar width={60} height={12} />
										</td>
										<td />
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}
