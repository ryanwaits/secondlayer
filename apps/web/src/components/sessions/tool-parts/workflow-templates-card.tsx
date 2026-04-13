"use client";

interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	trigger: string;
	prompt: string;
}

interface WorkflowTemplatesCardProps {
	templates: WorkflowTemplate[];
}

export function WorkflowTemplatesCard({
	templates,
}: WorkflowTemplatesCardProps) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">Workflow templates</div>
			{templates.map((t) => (
				<div key={t.id} className="tool-action-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{t.name}</span>
						<span className="tool-action-reason">{t.description}</span>
					</div>
					<span className="tool-badge">{t.trigger}</span>
				</div>
			))}
		</div>
	);
}
