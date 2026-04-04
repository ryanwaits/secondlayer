"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface StreamDangerZoneProps {
	streamId: string;
	streamName: string;
	status: string;
	sessionToken: string;
}

export function StreamDangerZone({
	streamId,
	streamName,
	status,
	sessionToken,
}: StreamDangerZoneProps) {
	const router = useRouter();
	const [confirmDelete, setConfirmDelete] = useState(false);

	async function handlePauseResume() {
		const action = status === "active" ? "pause" : "resume";
		await fetch(`/api/streams/${streamId}/${action}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		router.refresh();
	}

	async function handleDelete() {
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		await fetch(`/api/streams/${streamId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		router.push("/streams");
	}

	return (
		<div className="sg-danger-zone">
			<div className="sg-danger-row">
				<span className="sg-danger-label">
					{status === "active" ? "Pause" : "Resume"} this stream
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
						? `Type "${streamName}" to confirm deletion`
						: "Delete this stream permanently"}
				</span>
				<button
					type="button"
					className="sg-danger-btn delete"
					onClick={handleDelete}
				>
					{confirmDelete ? "Confirm delete" : "Delete stream"}
				</button>
			</div>
		</div>
	);
}
