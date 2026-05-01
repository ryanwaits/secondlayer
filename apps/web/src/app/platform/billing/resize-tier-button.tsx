"use client";

import { useState } from "react";

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	storageUsedMb: number | null;
	apiUrl: string;
	suspendedAt: string | null;
	createdAt: string;
}

interface Props {
	targetPlan: "launch" | "scale";
	currentPlan: string;
	label: string;
	variant?: "primary" | "ghost";
	sessionToken: string;
	onResized: (tenant: TenantSummary) => void;
}

/**
 * Paid → paid resize trigger. Confirms inline (no modal), then POSTs
 * `/api/tenants/me/resize` which updates both the Stripe subscription
 * and the tenant containers in one shot.
 */
export function ResizeTierButton({
	targetPlan,
	currentPlan,
	label,
	variant = "primary",
	sessionToken,
	onResized,
}: Props) {
	const [state, setState] = useState<
		"idle" | "confirming" | "resizing" | "error"
	>("idle");
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		setState("resizing");
		setError(null);
		try {
			const res = await fetch("/api/tenants/me/resize", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ plan: targetPlan }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(body.error ?? `Resize failed (${res.status})`);
			}
			const data = (await res.json()) as { tenant: TenantSummary };
			onResized(data.tenant);
			setState("idle");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Resize failed");
			setState("error");
		}
	};

	const className =
		variant === "primary" ? "settings-btn primary" : "settings-btn ghost";

	if (state === "confirming") {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<div className="instance-banner warning">
					<span className="banner-dot" />
					<div className="banner-body">
						<strong>
							Resize {currentPlan} → {targetPlan}?
						</strong>{" "}
						~30s downtime. Stripe sub updates with prorated credit.
					</div>
				</div>
				<div style={{ display: "flex", gap: 6 }}>
					<button
						type="button"
						className="settings-btn primary small"
						onClick={handleConfirm}
					>
						Confirm
					</button>
					<button
						type="button"
						className="settings-btn ghost small"
						onClick={() => setState("idle")}
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<>
			<button
				type="button"
				className={className}
				onClick={() => setState("confirming")}
				disabled={state === "resizing"}
			>
				{state === "resizing" ? "Resizing…" : label}
			</button>
			{state === "error" && error && (
				<div
					style={{
						marginTop: 6,
						fontSize: 11,
						color: "var(--red)",
					}}
				>
					{error}
				</div>
			)}
		</>
	);
}
