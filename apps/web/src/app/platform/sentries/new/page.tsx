"use client";

import { OverviewTopbar } from "@/components/console/overview-topbar";
import { useRouter } from "next/navigation";
import { useState } from "react";

const BROWSER_API_URL =
	process.env.NEXT_PUBLIC_SL_API_URL || "http://localhost:3800";

export default function NewSentryPage() {
	const router = useRouter();
	const [name, setName] = useState("");
	const [principal, setPrincipal] = useState("");
	const [thresholdStx, setThresholdStx] = useState("100000");
	const [webhook, setWebhook] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		// Convert STX → µSTX as decimal string (10^6). Keep everything string-
		// based so we don't need BigInt literals (tsconfig target is ES2017).
		const stxDigits = thresholdStx.replace(/[^0-9]/g, "");
		if (!stxDigits || stxDigits === "0") {
			setError("Threshold must be a whole number of STX greater than 0");
			setSubmitting(false);
			return;
		}
		const thresholdMicroStx = `${stxDigits}000000`;

		try {
			const res = await fetch(`${BROWSER_API_URL}/api/sentries`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					kind: "large-outflow",
					name,
					config: { principal, thresholdMicroStx },
					delivery_webhook: webhook,
					active: true,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				setError(
					typeof body.error === "string"
						? body.error
						: JSON.stringify(body.error ?? "failed"),
				);
				setSubmitting(false);
				return;
			}
			const body = (await res.json()) as { sentry: { id: string } };
			router.push(`/sentries/${body.sentry.id}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "failed");
			setSubmitting(false);
		}
	};

	return (
		<>
			<OverviewTopbar page="New sentry" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div
					className="overview-inner"
					style={{ maxWidth: 600, margin: "0 auto" }}
				>
					<h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>
						Enable a sentry
					</h1>
					<form
						onSubmit={handleSubmit}
						style={{ display: "flex", flexDirection: "column", gap: 16 }}
					>
						<label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 13, fontWeight: 500 }}>Name</span>
							<input
								className="input"
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. treasury watch"
							/>
						</label>

						<label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 13, fontWeight: 500 }}>Kind</span>
							<select className="input" disabled>
								<option>
									Large outflow (watch for transfers above threshold)
								</option>
							</select>
							<span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
								More kinds coming soon
							</span>
						</label>

						<label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 13, fontWeight: 500 }}>
								Principal to watch
							</span>
							<input
								className="input"
								required
								value={principal}
								onChange={(e) => setPrincipal(e.target.value)}
								placeholder="SP... or SP....contract-name"
								pattern="^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$"
							/>
							<span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
								Alerts fire on any STX transfer to or from this address.
							</span>
						</label>

						<label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 13, fontWeight: 500 }}>
								Threshold (STX)
							</span>
							<input
								className="input"
								type="number"
								min="1"
								required
								value={thresholdStx}
								onChange={(e) => setThresholdStx(e.target.value)}
							/>
							<span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
								Alert only on transfers larger than this.
							</span>
						</label>

						<label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 13, fontWeight: 500 }}>
								Delivery webhook
							</span>
							<input
								className="input"
								type="url"
								required
								value={webhook}
								onChange={(e) => setWebhook(e.target.value)}
								placeholder="https://hooks.slack.com/services/…"
								pattern="https://.*"
							/>
							<span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
								Slack incoming webhook, Discord webhook, or any Slack-compatible
								endpoint.
							</span>
						</label>

						{error && (
							<div
								style={{
									padding: 12,
									background: "var(--error-bg, #fee)",
									border: "1px solid var(--error-border, #fcc)",
									borderRadius: 6,
									color: "var(--error-fg, #933)",
									fontSize: 13,
								}}
							>
								{error}
							</div>
						)}

						<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
							<button
								type="submit"
								disabled={submitting}
								className="btn btn-primary"
							>
								{submitting ? "Creating…" : "Create sentry"}
							</button>
							<button
								type="button"
								onClick={() => router.push("/sentries")}
								className="btn"
							>
								Cancel
							</button>
						</div>
					</form>
				</div>
			</div>
		</>
	);
}
