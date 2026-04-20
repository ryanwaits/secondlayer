"use client";

import { useEffect, useState } from "react";

export type ProvisionStage = "slug" | "postgres" | "api" | "processor" | "dns";

const STAGES: { id: ProvisionStage; label: string }[] = [
	{ id: "slug", label: "Allocating slug" },
	{ id: "postgres", label: "Postgres container" },
	{ id: "api", label: "API container" },
	{ id: "processor", label: "Subgraph processor" },
	{ id: "dns", label: "DNS · TLS certificate" },
];

// Until the provisioner streams real stage events, simulate forward progression
// so the user sees motion during the 30-60s provision window. Each step ticks
// forward every ~7s unless the parent already reports `activeStage`.
const DEFAULT_TICK_MS = 7_000;

export function ProvisionProgress({
	activeStage,
	slug,
}: {
	activeStage?: ProvisionStage;
	slug?: string;
}) {
	const [ticked, setTicked] = useState<ProvisionStage>("slug");
	const current = activeStage ?? ticked;

	useEffect(() => {
		if (activeStage) return; // parent controls progression
		const idx = STAGES.findIndex((s) => s.id === ticked);
		if (idx < 0 || idx >= STAGES.length - 1) return;
		const t = setTimeout(() => {
			setTicked(STAGES[idx + 1].id);
		}, DEFAULT_TICK_MS);
		return () => clearTimeout(t);
	}, [ticked, activeStage]);

	const currentIdx = STAGES.findIndex((s) => s.id === current);

	return (
		<div className="provision-progress">
			{STAGES.map((stage, idx) => {
				const status =
					idx < currentIdx ? "done" : idx === currentIdx ? "active" : "";
				const showSlug = stage.id === "slug" && slug && status !== "";
				return (
					<div key={stage.id} className={`step${status ? ` ${status}` : ""}`}>
						<span className="check">{idx < currentIdx ? "✓" : ""}</span>
						{stage.label}
						{showSlug && (
							<span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
								· {slug}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
