"use client";

import { useState } from "react";

interface Props {
	tier: "launch" | "scale";
	label: string;
	variant?: "primary" | "ghost";
}

export function UpgradeButton({ tier, label, variant = "primary" }: Props) {
	const [state, setState] = useState<
		{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
	>({ kind: "idle" });

	const className =
		variant === "primary" ? "settings-btn primary" : "settings-btn";

	const handleClick = async () => {
		setState({ kind: "loading" });
		try {
			const res = await fetch("/api/billing/upgrade", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ tier }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				if (res.status === 503) {
					setState({
						kind: "error",
						message:
							"Billing not fully configured yet — email hey@secondlayer.tools",
					});
					return;
				}
				setState({
					kind: "error",
					message: body.error ?? `Upgrade failed (${res.status})`,
				});
				return;
			}
			const data = (await res.json()) as { url?: string };
			if (!data.url) {
				setState({ kind: "error", message: "No checkout URL returned" });
				return;
			}
			window.location.href = data.url;
		} catch (err) {
			setState({
				kind: "error",
				message: err instanceof Error ? err.message : "Upgrade failed",
			});
		}
	};

	return (
		<>
			<button
				type="button"
				className={className}
				onClick={handleClick}
				disabled={state.kind === "loading"}
			>
				{state.kind === "loading" ? "Redirecting…" : label}
			</button>
			{state.kind === "error" ? (
				<div
					style={{
						marginTop: 8,
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
