"use client";

import { formatCents } from "@/lib/usage";
import { useState } from "react";

const BROWSER_API_URL = "/api/billing/caps";

interface Props {
	initialCapCents: number | null;
	initialThresholdPct: number;
	currentSpendCents: number;
}

type SaveState =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "success"; message: string }
	| { kind: "error"; message: string };

export function CapForm({
	initialCapCents,
	initialThresholdPct,
	currentSpendCents,
}: Props) {
	const [capDollars, setCapDollars] = useState<string>(
		initialCapCents != null ? (initialCapCents / 100).toFixed(0) : "",
	);
	const [thresholdPct, setThresholdPct] = useState<string>(
		String(initialThresholdPct),
	);
	const [state, setState] = useState<SaveState>({ kind: "idle" });

	const save = async () => {
		setState({ kind: "idle" });

		const capDigits = capDollars.replace(/[^0-9]/g, "");
		const thresholdDigits = thresholdPct.replace(/[^0-9]/g, "");

		if (!capDigits) {
			setState({ kind: "error", message: "Enter a cap of at least $1" });
			return;
		}

		const newCapCents = Number(capDigits) * 100;
		const newThreshold = Number(thresholdDigits);

		if (newCapCents < 100) {
			setState({ kind: "error", message: "Cap must be at least $1" });
			return;
		}
		if (newThreshold < 1 || newThreshold > 100) {
			setState({ kind: "error", message: "Threshold must be 1–100%" });
			return;
		}

		if (newCapCents < currentSpendCents) {
			const proceed = window.confirm(
				`Current spend is ${formatCents(currentSpendCents)}. Setting the cap to ${formatCents(
					newCapCents,
				)} will freeze your services within a few minutes. Continue?`,
			);
			if (!proceed) return;
		}

		setState({ kind: "saving" });

		try {
			const res = await fetch(BROWSER_API_URL, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					monthlyCapCents: newCapCents,
					alertThresholdPct: newThreshold,
				}),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setState({
					kind: "error",
					message: body.error ?? `Failed (${res.status})`,
				});
				return;
			}
			setState({
				kind: "success",
				message: `Saved · ${formatCents(newCapCents)}/mo`,
			});
			setTimeout(() => setState({ kind: "idle" }), 3000);
		} catch (err) {
			setState({
				kind: "error",
				message: err instanceof Error ? err.message : "Failed",
			});
		}
	};

	const removeCap = async () => {
		if (
			!window.confirm(
				"Remove your spend cap? Services will no longer auto-freeze at any amount.",
			)
		)
			return;

		setState({ kind: "saving" });

		try {
			const res = await fetch(BROWSER_API_URL, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ monthlyCapCents: null }),
			});
			if (!res.ok) {
				setState({ kind: "error", message: `Failed (${res.status})` });
				return;
			}
			setCapDollars("");
			setState({ kind: "success", message: "Cap removed" });
			setTimeout(() => setState({ kind: "idle" }), 3000);
		} catch (err) {
			setState({
				kind: "error",
				message: err instanceof Error ? err.message : "Failed",
			});
		}
	};

	const saving = state.kind === "saving";

	return (
		<>
			<div className="settings-row">
				<div className="settings-row-label">
					<div className="settings-row-label-name">Monthly spend cap</div>
					<div className="settings-row-label-desc">
						Hard limit. Services freeze when cap is hit.
					</div>
				</div>
				<div className="settings-row-control">
					<div className="inline-input">
						<span className="prefix">$</span>
						<input
							type="number"
							min="1"
							step="1"
							value={capDollars}
							onChange={(e) => setCapDollars(e.target.value)}
							placeholder="200"
							disabled={saving}
						/>
						<button
							type="button"
							className="settings-btn"
							onClick={save}
							disabled={saving}
						>
							{saving ? "Saving…" : "Save"}
						</button>
						{initialCapCents != null ? (
							<button
								type="button"
								className="settings-btn"
								onClick={removeCap}
								disabled={saving}
								style={{ color: "var(--text-muted)" }}
							>
								Remove cap
							</button>
						) : null}
					</div>
				</div>
			</div>

			<div className="settings-row">
				<div className="settings-row-label">
					<div className="settings-row-label-name">Alert threshold</div>
					<div className="settings-row-label-desc">
						Email when projected spend passes this %.
					</div>
				</div>
				<div className="settings-row-control">
					<div className="inline-input">
						<input
							type="number"
							min="1"
							max="100"
							step="1"
							value={thresholdPct}
							onChange={(e) => setThresholdPct(e.target.value)}
							disabled={saving}
						/>
						<span className="prefix">% of cap</span>
					</div>
				</div>
			</div>

			{state.kind === "success" ? (
				<div className="cap-save-status success">{state.message}</div>
			) : null}
			{state.kind === "error" ? (
				<div className="cap-save-status error">{state.message}</div>
			) : null}
		</>
	);
}
