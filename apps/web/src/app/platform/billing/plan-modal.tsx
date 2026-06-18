"use client";

import { useEffect, useState } from "react";
import s from "./billing.module.css";

/**
 * "Choose a plan" modal — price-forward plan cards (the full feature ladder
 * lives on the pricing page, linked). Plan data mirrors
 * @secondlayer/platform/pricing (PLANS); keep in sync. Pro is the only
 * self-serve checkout; Scale and Enterprise are sold directly.
 */

type Tier = "none" | "launch" | "scale" | "enterprise";

interface PlanCard {
	tier: Tier;
	name: string;
	qualifier: string;
	price: string;
	priceSuffix?: string;
	tagline: string;
	cta: "self-serve" | "contact" | "none";
}

const PLAN_CARDS: PlanCard[] = [
	{
		tier: "none",
		name: "Free",
		qualifier: "No card",
		price: "$0",
		priceSuffix: "/mo",
		tagline: "Read and prototype on decoded Stacks data.",
		cta: "none",
	},
	{
		tier: "launch",
		name: "Pro",
		qualifier: "Most teams pick this",
		price: "$79",
		priceSuffix: "/mo",
		tagline: "Hosted, always-on data for shipping an app.",
		cta: "self-serve",
	},
	{
		tier: "scale",
		name: "Scale",
		qualifier: "High volume",
		price: "$299",
		priceSuffix: "/mo",
		tagline: "Dedicated capacity and a 24h SLA.",
		cta: "contact",
	},
	{
		tier: "enterprise",
		name: "Enterprise",
		qualifier: "White-glove",
		price: "Custom",
		tagline: "SLAs, regions, SSO, and a success engineer.",
		cta: "contact",
	},
];

export function PlanModal({ currentTier }: { currentTier: Tier }) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	async function selectPlan(tier: "launch" | "scale") {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/billing/upgrade", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tier, interval: "month" }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) throw new Error(data.error ?? "Upgrade failed");
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Upgrade failed");
			setBusy(false);
		}
	}

	const triggerLabel = currentTier === "none" ? "Upgrade" : "Change plan";

	return (
		<>
			<button
				type="button"
				className={s.btnAccent}
				onClick={() => setOpen(true)}
			>
				{triggerLabel}
			</button>

			{open && (
				<div
					className={s.overlay}
					onClick={(e) => {
						if (e.target === e.currentTarget) setOpen(false);
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") setOpen(false);
					}}
				>
					<div className={s.modal}>
						<button
							type="button"
							className={s.modalClose}
							onClick={() => setOpen(false)}
							aria-label="Close"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d="M4 4l8 8M12 4l-8 8" />
							</svg>
						</button>

						<h2 className={s.modalTitle}>Choose a plan</h2>
						<p className={s.modalSub}>
							Public reads stay free on every plan. For the full breakdown,{" "}
							<a href="/site/pricing">visit the pricing page</a>.
						</p>

						{error && <p className={s.modalErr}>{error}</p>}

						<div className={s.planGrid}>
							{PLAN_CARDS.map((p) => {
								const isCurrent = p.tier === currentTier;
								return (
									<div
										className={`${s.planCard} ${isCurrent ? s.planCardOn : ""}`}
										key={p.tier}
									>
										<div className={s.planEyebrow}>
											{p.name} · {isCurrent ? "Current plan" : p.qualifier}
										</div>
										<div
											className={s.planPrice}
											style={
												p.price === "Custom"
													? { color: "var(--accent)" }
													: undefined
											}
										>
											{p.price}
											{p.priceSuffix && <small>{p.priceSuffix}</small>}
										</div>
										<div className={s.planTag}>{p.tagline}</div>
										<div className={s.planCta}>
											{isCurrent ? (
												<span className={s.cur}>Current plan</span>
											) : p.cta === "self-serve" ? (
												<button
													type="button"
													className={s.btnAccent}
													onClick={() => selectPlan("launch")}
													disabled={busy}
												>
													{busy ? "Redirecting…" : "Select plan"}
												</button>
											) : p.cta === "contact" ? (
												<a
													className={s.btnGhost}
													href="mailto:ryan@secondlayer.tools?subject=Secondlayer%20plans"
												>
													Contact sales
												</a>
											) : (
												<span className={s.cur}>&nbsp;</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
