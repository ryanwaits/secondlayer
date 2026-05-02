"use client";

import type { Plan, PlanId } from "@secondlayer/shared/pricing";
import { useState } from "react";

function formatPrice(p: Plan): string {
	if (p.monthlyPriceCents == null) return "Custom";
	if (p.monthlyPriceCents === 0) return "Free";
	return `$${p.monthlyPriceCents / 100}/mo`;
}

function formatSpecs(p: Plan): { cpu: string; ram: string; storage: string } {
	return {
		cpu: String(p.totalCpus),
		ram:
			p.totalMemoryMb >= 1024
				? `${p.totalMemoryMb / 1024} GB`
				: `${p.totalMemoryMb} MB`,
		storage:
			p.storageLimitMb < 0
				? "unlimited"
				: p.storageLimitMb >= 1024
					? `${p.storageLimitMb / 1024} GB`
					: `${p.storageLimitMb} MB`,
	};
}

export interface ProvisionResponse {
	tenant: {
		slug: string;
		apiUrl: string;
		plan: string;
	};
	credentials: { apiUrl: string; anonKey: string; serviceKey: string };
}

export function ProvisionStart({
	sessionToken,
	plans,
	onProvisioned,
	onProvisioning,
}: {
	sessionToken: string;
	plans: Record<PlanId, Plan>;
	onProvisioned: (resp: ProvisionResponse) => void;
	onProvisioning: () => void;
}) {
	const provisionPlans: readonly Plan[] = [
		plans.hobby,
		plans.launch,
		plans.scale,
	];

	// Default to Hobby — zero-friction starting point. Users self-select
	// Launch+ when they need more compute or want to skip the auto-pause.
	const [selected, setSelected] = useState<string>("hobby");
	const [state, setState] = useState<"idle" | "provisioning" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleStart = async () => {
		setState("provisioning");
		setError(null);
		onProvisioning();
		try {
			const res = await fetch("/api/tenants", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ plan: selected }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Provisioning failed (${res.status})`);
			}
			const data = (await res.json()) as ProvisionResponse;
			onProvisioned(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
			setState("error");
		}
	};

	return (
		<div>
			<h1 className="settings-title">Provision your instance</h1>
			<p className="settings-desc">
				Pick a plan. We'll provision your dedicated Postgres, API, and subgraph
				processor. Takes about a minute. Start free, resize anytime.
			</p>

			<div className="instance-plan-grid">
				{provisionPlans.map((plan) => {
					const specs = formatSpecs(plan);
					return (
						<button
							type="button"
							key={plan.id}
							className="instance-plan-card"
							data-selected={selected === plan.id}
							onClick={() => setSelected(plan.id)}
						>
							<div className="tag">{plan.tagline}</div>
							<div className="name">{plan.displayName}</div>
							<div className="price">{formatPrice(plan)}</div>
							<div className="specs">
								<span>{specs.cpu}</span> vCPU
								<br />
								<span>{specs.ram}</span> RAM
								<br />
								<span>{specs.storage}</span> storage
							</div>
							{plan.id === "hobby" && (
								<div
									style={{
										fontSize: 11,
										color: "var(--text-muted)",
										marginTop: 8,
										lineHeight: 1.4,
									}}
								>
									Pauses after 7 days idle. Resumes on first query.
								</div>
							)}
						</button>
					);
				})}
			</div>

			<div className="settings-hint" style={{ marginBottom: 20 }}>
				Pay for compute, not features. Cancel anytime.
			</div>

			{error && (
				<div className="instance-banner danger" style={{ marginBottom: 16 }}>
					<span className="banner-dot" />
					<div className="banner-body">{error}</div>
				</div>
			)}

			<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
				<button
					type="button"
					className="settings-btn primary"
					disabled={state === "provisioning"}
					onClick={handleStart}
				>
					{state === "provisioning" ? "Provisioning…" : "Create instance"}
				</button>
				<span className="settings-hint" style={{ marginTop: 0 }}>
					Provisioning usually completes in under a minute.
				</span>
			</div>
		</div>
	);
}
