import { EmptyState } from "@/components/console/empty-state";
import { NotFoundTracker } from "@/components/not-found-tracker";

export default function SubgraphNotFound() {
	return (
		<>
			<NotFoundTracker boundary="subgraph" />
			<div className="dash-page-header">
				<h1 className="dash-page-title">Subgraph not found</h1>
			</div>
			<EmptyState
				message="This subgraph does not exist or has been deleted."
				action={{ label: "Back to subgraphs", href: "/subgraphs" }}
			/>
		</>
	);
}
