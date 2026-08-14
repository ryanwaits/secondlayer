import { EmptyState } from "@/components/console/empty-state";

export default function SubgraphNotFound() {
	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Not found</h1>
			</div>
			<EmptyState
				message="This subgraph, table, or subscription does not exist on this instance — or it has been deleted."
				action={{ label: "Back to subgraphs", href: "/subgraphs" }}
			/>
		</>
	);
}
