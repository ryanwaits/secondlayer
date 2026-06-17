"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Danger zone — permanent delete. DELETE /api/subgraphs/<name> cancels any
 * in-flight operation then drops the schema (irreversible), so it's gated
 * behind an inline confirm.
 */
export function SubgraphDangerZone({
	subgraphName,
	sessionToken,
}: {
	subgraphName: string;
	sessionToken: string;
}) {
	const router = useRouter();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function handleDelete() {
		setBusy(true);
		setError("");
		try {
			const res = await fetch(`/api/subgraphs/${subgraphName}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
			router.push("/platform/subgraphs");
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to delete");
			setBusy(false);
		}
	}

	return (
		<div className="sg-set-row">
			<div className="sg-set-info">
				<div className="sg-set-label">Delete subgraph</div>
				<div className="sg-set-desc">
					Permanently delete <span className="mono">{subgraphName}</span> and
					all its tables. This cannot be undone.
				</div>
				{error && <div className="sg-set-err">{error}</div>}
			</div>
			<div className="sg-set-action">
				{confirming ? (
					<>
						<button
							type="button"
							className="dash-btn"
							onClick={() => setConfirming(false)}
							disabled={busy}
						>
							Cancel
						</button>
						<button
							type="button"
							className="sg-btn-danger"
							onClick={handleDelete}
							disabled={busy}
						>
							{busy ? "Deleting…" : "Confirm delete"}
						</button>
					</>
				) : (
					<button
						type="button"
						className="sg-btn-danger"
						onClick={() => setConfirming(true)}
					>
						Delete
					</button>
				)}
			</div>
		</div>
	);
}
