"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import s from "./billing.module.css";

/**
 * Client half of /platform/billing: state-dependent actions plus the
 * post-checkout resolve. Landing with ?upgrade=success fires one
 * POST /api/billing/resolve (a direct Stripe read that syncs the plan
 * immediately instead of waiting on the webhook), then refreshes.
 */
export function BillingActions({
	state,
	hasSubscription,
}: {
	state: "free" | "trialing" | "active" | "ending";
	hasSubscription: boolean;
}) {
	const router = useRouter();
	const params = useSearchParams();
	const [busy, setBusy] = useState<"upgrade" | "portal" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const resolvedOnce = useRef(false);

	useEffect(() => {
		if (params.get("upgrade") !== "success" || resolvedOnce.current) return;
		resolvedOnce.current = true;
		fetch("/api/billing/resolve", { method: "POST" })
			.then(() => router.replace("/platform/billing"))
			.then(() => router.refresh())
			.catch(() => {});
	}, [params, router]);

	async function upgrade() {
		setBusy("upgrade");
		setError(null);
		try {
			const res = await fetch("/api/billing/upgrade", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tier: "launch", interval: "month" }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) throw new Error(data.error ?? "Upgrade failed");
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Upgrade failed");
			setBusy(null);
		}
	}

	async function openPortal() {
		setBusy("portal");
		setError(null);
		try {
			const res = await fetch("/api/billing/portal");
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) throw new Error(data.error ?? "Portal failed");
			window.location.assign(data.url);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Portal failed");
			setBusy(null);
		}
	}

	return (
		<>
			<div className={s.actions}>
				{state === "free" && (
					<>
						<button
							type="button"
							className={s.btnInk}
							onClick={upgrade}
							disabled={busy !== null}
						>
							{busy === "upgrade" ? "Redirecting…" : "Upgrade to Pro · $79/mo"}
						</button>
						<span className={s.actHint}>
							14-day trial · card up front · $0 today
						</span>
					</>
				)}
				{state === "ending" && (
					<button
						type="button"
						className={s.btnInk}
						onClick={openPortal}
						disabled={busy !== null}
					>
						{busy === "portal" ? "Redirecting…" : "Resume Pro"}
					</button>
				)}
				{hasSubscription && (
					<button
						type="button"
						className={s.btnGhost}
						onClick={openPortal}
						disabled={busy !== null}
					>
						{busy === "portal" ? "Redirecting…" : "Manage subscription"}{" "}
						<span className={s.ext}>↗</span>
					</button>
				)}
				{error && <span className={s.actErr}>{error}</span>}
			</div>
			{hasSubscription && (
				<p className={s.portalNote}>
					{state === "ending"
						? "resume re-opens the same subscription in the Stripe portal. No new checkout, no new trial."
						: "opens the Stripe customer portal: invoices, card, cancel."}{" "}
					<code>billing.stripe.com</code>
				</p>
			)}
		</>
	);
}
