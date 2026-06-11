"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Client half of /platform/billing: the upgrade + portal buttons, and the
 * post-checkout resolve call. Landing with ?upgrade=success fires one
 * POST /api/billing/resolve (a direct Stripe read that syncs the plan
 * immediately instead of waiting on the webhook), then refreshes the page.
 */
export function BillingActions({
	plan,
	hasSubscription,
}: {
	plan: string;
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
		<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
			{plan === "none" && (
				<button
					type="button"
					className="auth-bar-cta"
					onClick={upgrade}
					disabled={busy !== null}
				>
					{busy === "upgrade" ? "Redirecting…" : "Upgrade to Pro — $99/mo"}
				</button>
			)}
			{hasSubscription && (
				<button
					type="button"
					className="auth-bar-cta"
					onClick={openPortal}
					disabled={busy !== null}
				>
					{busy === "portal" ? "Redirecting…" : "Manage subscription"}
				</button>
			)}
			{error && (
				<span style={{ color: "var(--danger, #c00)", fontSize: "0.85em" }}>
					{error}
				</span>
			)}
		</div>
	);
}
