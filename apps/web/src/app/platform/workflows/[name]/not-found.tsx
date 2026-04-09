import { EmptyState } from "@/components/console/empty-state";

export default function WorkflowNotFound() {
	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Workflow not found</h1>
			</div>
			<EmptyState
				message="This workflow doesn't exist or you don't have access."
				action={{ label: "Back to workflows", href: "/workflows" }}
			/>
		</>
	);
}
