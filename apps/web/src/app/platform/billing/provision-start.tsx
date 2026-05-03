"use client";

import type { Plan, PlanId } from "@secondlayer/shared/pricing";
import { useCallback, useEffect, useState } from "react";
import { UpgradeButton } from "./upgrade-button";

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
	accountPlan,
	plans,
	onProvisioned,
	onProvisioning,
}: {
	sessionToken: string;
	accountPlan: string;
	plans: Record<PlanId, Plan>;
	onProvisioned: (resp: ProvisionResponse) => void;
	onProvisioning: () => void;
}) {
	const provisionPlans: readonly Plan[] = [plans.launch, plans.scale];

	const [selected, setSelected] = useState<string>(
		accountPlan === "scale" ? "scale" : "launch",
	);
	const [state, setState] = useState<"idle" | "provisioning" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleStart = useCallback(async () => {
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
	}, [onProvisioned, onProvisioning, selected, sessionToken]);

	useEffect(() => {
		if (state !== "idle" || accountPlan !== selected) return;
		if (
			new URLSearchParams(window.location.search).get("upgrade") !== "success"
		) {
			return;
		}
		void handleStart();
	}, [accountPlan, handleStart, selected, state]);

	return (
		<div>
			<h1 className="settings-title">Provision your instance</h1>
			<p className="settings-desc">
				Pick a plan. We'll provision your dedicated Postgres, API, and subgraph
				processor. Start with a 30-day trial, then keep the same instance when
				billing begins.
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
						</button>
					);
				})}
			</div>

			<div className="settings-hint" style={{ marginBottom: 20 }}>
				Card required. Trial runs 30 days, then billing starts automatically.
			</div>

			{error && (
				<div className="instance-banner danger" style={{ marginBottom: 16 }}>
					<span className="banner-dot" />
					<div className="banner-body">{error}</div>
				</div>
			)}

			<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
				{accountPlan === selected ? (
					<button
						type="button"
						className="settings-btn primary"
						disabled={state === "provisioning"}
						onClick={handleStart}
					>
						{state === "provisioning" ? "Provisioning…" : "Create instance"}
					</button>
				) : (
					<UpgradeButton
						tier={selected as "launch" | "scale"}
						label={`Start 30-day ${plans[selected as PlanId].displayName} trial`}
						variant="primary"
					/>
				)}
				<span className="settings-hint" style={{ marginTop: 0 }}>
					Provisioning usually completes in under a minute.
				</span>
			</div>
		</div>
	);
}
