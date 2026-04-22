"use client";

import { useState } from "react";

const PLANS = [
	{
		id: "launch",
		name: "Launch",
		price: "$99/mo",
		tag: "Hobbyist",
		specs: { cpu: "1", ram: "2 GB", storage: "10 GB" },
	},
	{
		id: "grow",
		name: "Grow",
		price: "$249/mo",
		tag: "Most popular",
		specs: { cpu: "2", ram: "4 GB", storage: "50 GB" },
	},
	{
		id: "scale",
		name: "Scale",
		price: "$599/mo",
		tag: "Production",
		specs: { cpu: "4", ram: "8 GB", storage: "200 GB" },
	},
] as const;

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
	onProvisioned,
	onProvisioning,
}: {
	sessionToken: string;
	onProvisioned: (resp: ProvisionResponse) => void;
	onProvisioning: () => void;
}) {
	// Pre-select Launch — cheapest, most accessible entry compute.
	const [selected, setSelected] = useState<string>("launch");
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
				processor. Takes about a minute.
			</p>

			<div className="instance-plan-grid">
				{PLANS.map((plan) => (
					<button
						type="button"
						key={plan.id}
						className="instance-plan-card"
						data-selected={selected === plan.id}
						onClick={() => setSelected(plan.id)}
					>
						<div className="tag">{plan.tag}</div>
						<div className="name">{plan.name}</div>
						<div className="price">{plan.price}</div>
						<div className="specs">
							<span>{plan.specs.cpu}</span> vCPU
							<br />
							<span>{plan.specs.ram}</span> RAM
							<br />
							<span>{plan.specs.storage}</span> storage
						</div>
					</button>
				))}
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
