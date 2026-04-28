import { EmptyState } from "@/components/console/empty-state";

export default function TableNotFound() {
	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Table not found</h1>
			</div>
			<EmptyState
				message="This table does not exist in the subgraph."
				action={{ label: "Back to subgraph", href: "/subgraphs" }}
			/>
		</>
	);
}
