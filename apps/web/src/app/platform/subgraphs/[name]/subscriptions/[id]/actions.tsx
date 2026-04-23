"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SubscriptionActions({
	id,
	subgraphName,
	status,
}: {
	id: string;
	subgraphName: string;
	status: "active" | "paused" | "error";
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

	async function call(path: string, method = "POST") {
		setBusy(true);
		setErr(null);
		try {
			const res = await fetch(path, {
				method,
				credentials: "same-origin",
			});
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
				signingSecret?: string;
			};
			if (!res.ok) {
				setErr(body.error ?? `HTTP ${res.status}`);
				return null;
			}
			return body;
		} finally {
			setBusy(false);
		}
	}

	async function onPauseResume() {
		const target = status === "active" ? "pause" : "resume";
		await call(`/api/subscriptions/${id}/${target}`);
		router.refresh();
	}

	async function onRotate() {
		if (
			!confirm(
				"Rotate signing secret? Any receiver using the old secret will fail verification until updated.",
			)
		) {
			return;
		}
		const body = await call(`/api/subscriptions/${id}/rotate-secret`);
		if (body?.signingSecret) setRotatedSecret(body.signingSecret);
	}

	async function onDelete() {
		if (
			!confirm(
				"Delete this subscription? Pending outbox entries will be cascade-deleted and cannot be recovered.",
			)
		) {
			return;
		}
		const body = await call(`/api/subscriptions/${id}`, "DELETE");
		if (body !== null) router.push(`/subgraphs/${subgraphName}/subscriptions`);
	}

	return (
		<div className="detail-section">
			<h2>Actions</h2>
			<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
				<button
					type="button"
					className="btn-secondary"
					onClick={onPauseResume}
					disabled={busy}
				>
					{status === "active" ? "Pause" : "Resume"}
				</button>
				<button
					type="button"
					className="btn-secondary"
					onClick={onRotate}
					disabled={busy}
				>
					Rotate signing secret
				</button>
				<button
					type="button"
					className="btn-danger"
					onClick={onDelete}
					disabled={busy}
				>
					Delete
				</button>
			</div>
			{err && (
				<p style={{ color: "var(--error)", marginTop: 8 }}>{err}</p>
			)}
			{rotatedSecret && (
				<div style={{ marginTop: 16 }}>
					<p className="detail-desc">
						New signing secret — copy now, won't be shown again.
					</p>
					<code
						style={{
							display: "block",
							padding: 12,
							background: "var(--code-bg)",
							wordBreak: "break-all",
						}}
					>
						{rotatedSecret}
					</code>
				</div>
			)}
		</div>
	);
}
