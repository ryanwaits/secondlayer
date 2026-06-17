"use client";

import { useEffect, useState } from "react";
import s from "./billing.module.css";

/**
 * "Choose a plan" modal — the upgrade entry point off the Plan settings card.
 * Plan display data mirrors @secondlayer/platform/pricing (PLANS) verbatim;
 * keep the two in sync. Pro is the only self-serve checkout (POST
 * /api/billing/upgrade → Stripe); Scale and Enterprise are sold directly.
 */

type Tier = "none" | "launch" | "scale" | "enterprise";

interface PlanCard {
	tier: Tier;
	name: string;
	pitch: string;
	priceLabel: string;
	price: string;
	priceSuffix?: string;
	featHead: string;
	features: string[];
	cta: "self-serve" | "contact" | "none";
}

const PLAN_CARDS: PlanCard[] = [
	{
		tier: "none",
		name: "Free",
		pitch: "Everything to read and prototype on decoded Stacks data.",
		priceLabel: "No card required",
		price: "$0",
		priceSuffix: "/mo",
		featHead: "Start with:",
		features: [
			"Keyless reads",
			"Decoded sBTC, PoX, Clarity",
			"Public subgraph reads",
			"10 req/s · last-24h window",
			"Community support",
		],
		cta: "none",
	},
	{
		tier: "launch",
		name: "Pro",
		pitch: "For shipping an app on hosted, always-on data.",
		priceLabel: "Starting at",
		price: "$79",
		priceSuffix: "/mo",
		featHead: "Everything in Free, plus:",
		features: [
			"250 req/s on Index and Streams",
			"Private subgraphs",
			"Genesis backfills (full history)",
			"25 webhook subscriptions + replay",
			"Usage budgets + alerts",
			"Email support",
		],
		cta: "self-serve",
	},
	{
		tier: "scale",
		name: "Scale",
		pitch: "For high-volume production and dedicated capacity.",
		priceLabel: "Starting at",
		price: "$299",
		priceSuffix: "/mo",
		featHead: "Everything in Pro, plus:",
		features: [
			"500 req/s on Index and Streams",
			"Heavy history + replay",
			"24h SLA · priority support",
		],
		cta: "contact",
	},
	{
		tier: "enterprise",
		name: "Enterprise",
		pitch: "For teams that need white-glove and an SLA.",
		priceLabel: " ",
		price: "Custom",
		featHead: "Everything in Scale, plus:",
		features: [
			"Custom rates + dedicated capacity",
			"SLAs · regions · SSO",
			"Dedicated success engineer",
		],
		cta: "contact",
	},
];

const CheckIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.75"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M3 8.5l3.2 3.2L13 4.5" />
	</svg>
);

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
							Public reads stay free on every plan. For the full ladder,{" "}
							<a href="/site/pricing">visit the pricing page</a>.
						</p>

						{error && <p className={s.modalErr}>{error}</p>}

						<div className={s.planGrid}>
							{PLAN_CARDS.map((p) => (
								<div className={s.planCol} key={p.tier}>
									<h3>{p.name}</h3>
									<p className={s.pitch}>{p.pitch}</p>

									<div className={s.planCta}>
										{p.tier === currentTier ? (
											<span className={s.current}>Current plan</span>
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
											<span className={s.current}>&nbsp;</span>
										)}
									</div>

									<div className={s.planDivider} />
									<div className={s.priceLabel}>{p.priceLabel}</div>
									<div
										className={s.priceLg}
										style={
											p.price === "Custom"
												? { color: "var(--accent)" }
												: undefined
										}
									>
										{p.price}
										{p.priceSuffix && <small>{p.priceSuffix}</small>}
									</div>

									<div className={s.featHead}>{p.featHead}</div>
									{p.features.map((f) => (
										<div className={s.feat} key={f}>
											<CheckIcon />
											{f}
										</div>
									))}
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
