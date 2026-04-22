"use client";

import { OverviewTopbar } from "@/components/console/overview-topbar";
import { useRouter } from "next/navigation";
import { useState } from "react";

const BROWSER_API_URL =
	process.env.NEXT_PUBLIC_SL_API_URL || "http://localhost:3800";

type Kind = "large-outflow" | "permission-change";

export default function NewSentryPage() {
	const router = useRouter();
	const [kind, setKind] = useState<Kind>("large-outflow");
	const [name, setName] = useState("");
	const [principal, setPrincipal] = useState("");
	const [thresholdStx, setThresholdStx] = useState("100000");
	const [adminFunctions, setAdminFunctions] = useState(
		"set-owner, set-admin, transfer-ownership",
	);
	const [webhook, setWebhook] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		let config: Record<string, unknown>;
		if (kind === "large-outflow") {
			const stxDigits = thresholdStx.replace(/[^0-9]/g, "");
			if (!stxDigits || stxDigits === "0") {
				setError("Threshold must be a whole number of STX greater than 0");
				setSubmitting(false);
				return;
			}
			config = { principal, thresholdMicroStx: `${stxDigits}000000` };
		} else {
			const fns = adminFunctions
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (fns.length === 0) {
				setError("Provide at least one admin function name");
				setSubmitting(false);
				return;
			}
			config = { principal, adminFunctions: fns };
		}

		try {
			const res = await fetch(`${BROWSER_API_URL}/api/sentries`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					kind,
					name,
					config,
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
			<OverviewTopbar path="Sentries" page="New sentry" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<h1 className="settings-title">Enable a sentry</h1>
					<p className="settings-desc">
						Sentries watch your Stacks contracts and triage anomalies with AI.
					</p>

					<form onSubmit={handleSubmit}>
						<div className="settings-section">
							<div className="settings-section-title">Basics</div>

							<div className="settings-field">
								<label className="settings-label" htmlFor="sentry-name">
									Name
								</label>
								<input
									id="sentry-name"
									className="settings-input"
									required
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="e.g. treasury watch"
								/>
							</div>

							<div className="settings-field">
								<label className="settings-label" htmlFor="sentry-kind">
									Kind
								</label>
								<select
									id="sentry-kind"
									className="settings-input"
									value={kind}
									onChange={(e) => setKind(e.target.value as Kind)}
								>
									<option value="large-outflow">
										Large outflow — watch for transfers above threshold
									</option>
									<option value="permission-change">
										Permission change — watch for admin function calls
									</option>
								</select>
							</div>
						</div>

						<div className="settings-section">
							<div className="settings-section-title">Target</div>

							<div className="settings-field">
								<label className="settings-label" htmlFor="sentry-principal">
									Principal to watch
								</label>
								<input
									id="sentry-principal"
									className="settings-input mono"
									required
									value={principal}
									onChange={(e) => setPrincipal(e.target.value)}
									placeholder={
										kind === "large-outflow"
											? "SP... or SP....contract-name"
											: "SP....contract-name"
									}
									pattern="^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$"
								/>
								<div className="settings-hint">
									{kind === "large-outflow"
										? "Alerts fire on any STX transfer to or from this address."
										: "Contract principal whose admin functions we watch."}
								</div>
							</div>

							{kind === "large-outflow" ? (
								<div className="settings-field">
									<label className="settings-label" htmlFor="sentry-threshold">
										Threshold (STX)
									</label>
									<input
										id="sentry-threshold"
										className="settings-input"
										type="number"
										min="1"
										required
										value={thresholdStx}
										onChange={(e) => setThresholdStx(e.target.value)}
									/>
									<div className="settings-hint">
										Alert only on transfers larger than this.
									</div>
								</div>
							) : (
								<div className="settings-field">
									<label className="settings-label" htmlFor="sentry-admin-fns">
										Admin functions
									</label>
									<input
										id="sentry-admin-fns"
										className="settings-input mono"
										required
										value={adminFunctions}
										onChange={(e) => setAdminFunctions(e.target.value)}
										placeholder="set-owner, set-admin, transfer-ownership"
									/>
									<div className="settings-hint">
										Comma-separated function names. Alerts fire on any
										successful call to these.
									</div>
								</div>
							)}
						</div>

						<div className="settings-section">
							<div className="settings-section-title">Delivery</div>

							<div className="settings-field">
								<label className="settings-label" htmlFor="sentry-webhook">
									Webhook URL
								</label>
								<input
									id="sentry-webhook"
									className="settings-input mono"
									type="url"
									required
									value={webhook}
									onChange={(e) => setWebhook(e.target.value)}
									placeholder="https://hooks.slack.com/services/…"
									pattern="https://.*"
								/>
								<div className="settings-hint">
									Slack incoming webhook, Discord webhook, or any
									Slack-compatible endpoint.
								</div>
							</div>
						</div>

						{error && (
							<div
								className="callout error"
								role="alert"
								style={{ marginBottom: 16 }}
							>
								<div className="callout-body">
									<div className="callout-title">Could not create sentry</div>
									<div className="callout-sub">{error}</div>
								</div>
							</div>
						)}

						<div style={{ display: "flex", gap: 8 }}>
							<button
								type="submit"
								disabled={submitting}
								className="settings-btn primary"
							>
								{submitting ? "Creating…" : "Create sentry"}
							</button>
							<button
								type="button"
								onClick={() => router.push("/sentries")}
								className="settings-btn ghost"
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
