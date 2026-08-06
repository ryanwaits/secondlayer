"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";

/**
 * Subscription settings and the destructive action, split into two exported
 * blocks so the page can place them under their own headings. Neither renders
 * a heading itself — the page owns section structure.
 */

function useSubscriptionCall() {
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	async function call(path: string, method = "POST") {
		setBusy(true);
		setErr(null);
		try {
			const res = await fetch(path, { method, credentials: "same-origin" });
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

	return { busy, err, call };
}

export function SubscriptionSettings({
	id,
	status,
}: {
	id: string;
	status: "active" | "paused" | "error";
}) {
	const router = useRouter();
	const { busy, err, call } = useSubscriptionCall();
	const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

	async function onPauseResume() {
		const target = status === "active" ? "pause" : "resume";
		const body = await call(`/api/subscriptions/${id}/${target}`);
		if (body !== null) posthog.capture(`subscription_${target}d`);
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
		if (body?.signingSecret) {
			setRotatedSecret(body.signingSecret);
			posthog.capture("subscription_signing_secret_rotated");
		}
	}

	return (
		<>
			<div className="sg-set-row">
				<div className="sg-set-info">
					<div className="sg-set-label">Delivery</div>
					<div className="sg-set-desc">
						{status === "active"
							? "Active. New rows deliver to the receiver as they're indexed."
							: "Paused. Rows keep accumulating in the outbox and deliver on resume."}
					</div>
				</div>
				<div className="sg-set-action">
					<button
						type="button"
						className="dash-btn"
						onClick={onPauseResume}
						disabled={busy}
					>
						{status === "active" ? "Pause" : "Resume"}
					</button>
				</div>
			</div>

			<div className="sg-set-row">
				<div className="sg-set-info">
					<div className="sg-set-label">Signing secret</div>
					<div className="sg-set-desc">
						Receivers verify deliveries with this. Rotating breaks any receiver
						still using the old one.
					</div>
					{rotatedSecret && (
						<>
							<div className="sg-set-desc" style={{ marginTop: 10 }}>
								New signing secret — copy it now, it won't be shown again.
							</div>
							<div className="sg-secret" style={{ marginTop: 6 }}>
								<code className="sg-secret-value">{rotatedSecret}</code>
							</div>
						</>
					)}
				</div>
				<div className="sg-set-action">
					<button
						type="button"
						className="dash-btn"
						onClick={onRotate}
						disabled={busy}
					>
						Rotate
					</button>
				</div>
			</div>

			{err && <div className="sg-set-err">{err}</div>}
		</>
	);
}

export function SubscriptionDangerZone({
	id,
	subgraphName,
}: {
	id: string;
	subgraphName: string;
}) {
	const router = useRouter();
	const { busy, err, call } = useSubscriptionCall();

	async function onDelete() {
		if (
			!confirm(
				"Delete this subscription? Pending outbox entries will be cascade-deleted and cannot be recovered.",
			)
		) {
			return;
		}
		const body = await call(`/api/subscriptions/${id}`, "DELETE");
		if (body !== null) {
			posthog.capture("subscription_deleted");
			router.push(`/subgraphs/${subgraphName}/subscriptions`);
		}
	}

	return (
		<div className="sg-danger">
			<div className="sg-set-row">
				<div className="sg-set-info">
					<div className="sg-set-label">Delete subscription</div>
					<div className="sg-set-desc">
						Pending outbox entries are cascade-deleted and cannot be recovered.
					</div>
					{err && <div className="sg-set-err">{err}</div>}
				</div>
				<div className="sg-set-action">
					<button
						type="button"
						className="sg-btn-danger"
						onClick={onDelete}
						disabled={busy}
					>
						{busy ? "Deleting…" : "Delete"}
					</button>
				</div>
			</div>
		</div>
	);
}
