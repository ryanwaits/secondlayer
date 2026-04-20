"use client";

import { useState } from "react";

export function DangerZone({
	slug,
	status,
	sessionToken,
	onSuspended,
	onDeleted,
	onRotateAll,
}: {
	slug: string;
	status: string;
	sessionToken: string;
	onSuspended: () => void;
	onDeleted: () => void;
	onRotateAll: () => void;
}) {
	const [busy, setBusy] = useState<"suspend" | "resume" | "delete" | null>(
		null,
	);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleteInput, setDeleteInput] = useState("");
	const [error, setError] = useState<string | null>(null);

	const callAction = async (path: string, method: string) => {
		const res = await fetch(path, {
			method,
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? `Request failed (${res.status})`);
		}
		return res.json();
	};

	const handleSuspend = async () => {
		if (busy) return;
		setBusy("suspend");
		setError(null);
		try {
			await callAction("/api/tenants/me/suspend", "POST");
			onSuspended();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Suspend failed");
		} finally {
			setBusy(null);
		}
	};

	const handleResume = async () => {
		if (busy) return;
		setBusy("resume");
		setError(null);
		try {
			await callAction("/api/tenants/me/resume", "POST");
			onSuspended();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Resume failed");
		} finally {
			setBusy(null);
		}
	};

	const handleDelete = async () => {
		if (busy || deleteInput !== slug) return;
		setBusy("delete");
		setError(null);
		try {
			await callAction("/api/tenants/me", "DELETE");
			onDeleted();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Delete failed");
			setBusy(null);
		}
	};

	const isSuspended = status === "suspended";

	return (
		<section className="settings-section">
			<div className="settings-section-title">Danger zone</div>

			{error && (
				<div className="instance-banner danger" style={{ marginBottom: 12 }}>
					<span className="banner-dot" />
					<div className="banner-body">{error}</div>
				</div>
			)}

			<div className="danger-card" style={{ marginBottom: 10 }}>
				<div>
					<div className="title">Rotate all keys</div>
					<div className="desc">
						Invalidates service + anon simultaneously. Use when a team member
						leaves or you suspect both keys are compromised.
					</div>
				</div>
				<button
					type="button"
					className="settings-btn ghost small"
					onClick={onRotateAll}
					disabled={busy !== null}
				>
					Rotate all
				</button>
			</div>

			<div className="danger-card" style={{ marginBottom: 10 }}>
				<div>
					<div className="title">
						{isSuspended ? "Resume instance" : "Suspend instance"}
					</div>
					<div className="desc">
						{isSuspended
							? "Start all containers. Data preserved while suspended."
							: "Stop all containers. Data preserved. Resume any time in ~20s."}
					</div>
				</div>
				<button
					type="button"
					className="settings-btn ghost small"
					onClick={isSuspended ? handleResume : handleSuspend}
					disabled={busy !== null}
				>
					{busy === "suspend"
						? "Suspending…"
						: busy === "resume"
							? "Resuming…"
							: isSuspended
								? "Resume"
								: "Suspend"}
				</button>
			</div>

			<div className="danger-card">
				<div>
					<div className="title">Delete instance</div>
					<div className="desc">
						Tears down containers and deletes all tenant data. Cannot be undone.
					</div>
				</div>
				{!confirmDelete ? (
					<button
						type="button"
						className="settings-btn danger small"
						onClick={() => setConfirmDelete(true)}
						disabled={busy !== null}
					>
						Delete
					</button>
				) : (
					<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
						<input
							type="text"
							className="settings-input mono"
							value={deleteInput}
							onChange={(e) => setDeleteInput(e.target.value)}
							placeholder={slug}
							style={{ width: 140, height: 32 }}
						/>
						<button
							type="button"
							className="settings-btn danger small"
							onClick={handleDelete}
							disabled={deleteInput !== slug || busy !== null}
						>
							{busy === "delete" ? "Deleting…" : "Confirm"}
						</button>
						<button
							type="button"
							className="settings-btn ghost small"
							onClick={() => {
								setConfirmDelete(false);
								setDeleteInput("");
							}}
							disabled={busy !== null}
						>
							Cancel
						</button>
					</div>
				)}
			</div>

			{confirmDelete && (
				<div className="settings-hint">
					Type the slug <code>{slug}</code> to confirm.
				</div>
			)}
		</section>
	);
}
