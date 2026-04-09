"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface WorkflowDangerZoneProps {
	workflowName: string;
	status: string;
}

export function WorkflowDangerZone({
	workflowName,
	status,
}: WorkflowDangerZoneProps) {
	const router = useRouter();
	const [confirmDelete, setConfirmDelete] = useState(false);

	async function handlePauseResume() {
		const action = status === "active" ? "pause" : "resume";
		await fetch(`/api/workflows/${workflowName}/${action}`, {
			method: "POST",
		});
		router.refresh();
	}

	async function handleDelete() {
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		await fetch(`/api/workflows/${workflowName}`, { method: "DELETE" });
		router.push("/workflows");
	}

	return (
		<div className="sg-danger-zone">
			<div className="sg-danger-row">
				<span className="sg-danger-label">
					{status === "active" ? "Pause" : "Resume"} this workflow
				</span>
				<button
					type="button"
					className="sg-danger-btn"
					onClick={handlePauseResume}
				>
					{status === "active" ? "Pause" : "Resume"}
				</button>
			</div>
			<div className="sg-danger-row">
				<span className="sg-danger-label">
					{confirmDelete
						? `Type "${workflowName}" to confirm deletion`
						: "Delete this workflow permanently"}
				</span>
				<button
					type="button"
					className="sg-danger-btn delete"
					onClick={handleDelete}
				>
					{confirmDelete ? "Confirm delete" : "Delete workflow"}
				</button>
			</div>
		</div>
	);
}
