"use client";

import { useState } from "react";

interface Props {
	label: string;
	sub: string;
}

export function PortalLink({ label, sub }: Props) {
	const [state, setState] = useState<
		{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
	>({ kind: "idle" });

	const openPortal = async () => {
		setState({ kind: "loading" });
		try {
			const res = await fetch("/api/billing/portal", {
				method: "GET",
				credentials: "include",
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setState({
					kind: "error",
					message:
						res.status === 400
							? "No subscription yet — upgrade first."
							: (body.error ?? `Portal failed (${res.status})`),
				});
				return;
			}
			const data = (await res.json()) as { url?: string };
			if (!data.url) {
				setState({ kind: "error", message: "No portal URL returned" });
				return;
			}
			window.location.href = data.url;
		} catch (err) {
			setState({
				kind: "error",
				message: err instanceof Error ? err.message : "Portal failed",
			});
		}
	};

	const loading = state.kind === "loading";

	return (
		<>
			<button
				type="button"
				className="plan-card"
				onClick={openPortal}
				disabled={loading}
				style={{
					textAlign: "left",
					cursor: loading ? "wait" : "pointer",
					width: "100%",
					font: "inherit",
					color: "inherit",
				}}
			>
				<div>
					<div className="plan-card-name">{label}</div>
					<div className="plan-card-sub">{sub}</div>
				</div>
				<span
					style={{
						fontFamily: "var(--font-mono-stack)",
						fontSize: 11,
						color: "var(--text-muted)",
					}}
				>
					{loading ? "Loading…" : "Stripe ↗"}
				</span>
			</button>
			{state.kind === "error" ? (
				<div
					style={{
						marginTop: 4,
						fontSize: 11,
						color: "var(--red)",
					}}
				>
					{state.message}
				</div>
			) : null}
		</>
	);
}
