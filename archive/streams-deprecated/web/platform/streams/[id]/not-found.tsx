import { EmptyState } from "@/components/console/empty-state";

export default function StreamNotFound() {
	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Stream not found</h1>
			</div>
			<EmptyState
				message="This stream doesn't exist or you don't have access."
				action={{ label: "Back to streams", href: "/streams" }}
			/>
		</>
	);
}
