import { EmptyState } from "@/components/console/empty-state";

export default function SubgraphNotFound() {
	return (
		<>
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
