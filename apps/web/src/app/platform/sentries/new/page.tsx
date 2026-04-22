"use client";

import { OverviewTopbar } from "@/components/console/overview-topbar";
import { useRouter } from "next/navigation";
import { useState } from "react";

const BROWSER_API_URL =
	process.env.NEXT_PUBLIC_SL_API_URL || "http://localhost:3800";

type Kind =
	| "large-outflow"
	| "permission-change"
	| "ft-outflow"
	| "contract-deployment"
	| "print-event-match";

const KIND_LABELS: Record<Kind, string> = {
	"large-outflow": "Large outflow — watch for STX transfers above threshold",
	"permission-change": "Permission change — watch for admin function calls",
	"ft-outflow": "FT outflow — watch for large SIP-010 token transfers",
	"contract-deployment":
		"Contract deployment — alert when a principal deploys a new contract",
	"print-event-match":
		"Print event — match a specific contract print (e.g. liquidation, drain)",
};

type BuildResult =
	| { ok: true; config: Record<string, unknown> }
	| { ok: false; error: string };

export default function NewSentryPage() {
	const router = useRouter();
	const [kind, setKind] = useState<Kind>("large-outflow");
	const [name, setName] = useState("");
	const [principal, setPrincipal] = useState("");
	const [thresholdStx, setThresholdStx] = useState("100000");
	const [adminFunctions, setAdminFunctions] = useState(
		"set-owner, set-admin, transfer-ownership",
	);
	const [assetIdentifier, setAssetIdentifier] = useState("");
	const [thresholdAmount, setThresholdAmount] = useState("1000000");
	const [printTopic, setPrintTopic] = useState("");
	const [webhook, setWebhook] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const buildConfig = (): BuildResult => {
		if (kind === "large-outflow") {
			const stxDigits = thresholdStx.replace(/[^0-9]/g, "");
			if (!stxDigits || stxDigits === "0") {
				return {
					ok: false,
					error: "Threshold must be a whole number of STX greater than 0",
				};
			}
			return {
				ok: true,
				config: { principal, thresholdMicroStx: `${stxDigits}000000` },
			};
		}

		if (kind === "permission-change") {
			const fns = adminFunctions
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (fns.length === 0) {
				return { ok: false, error: "Provide at least one admin function name" };
			}
			return { ok: true, config: { principal, adminFunctions: fns } };
		}

		if (kind === "ft-outflow") {
			if (!assetIdentifier.includes("::")) {
				return {
					ok: false,
					error:
						"Asset identifier must include ::, e.g. SP...CONTRACT.token-name::token-symbol",
				};
			}
			const digits = thresholdAmount.replace(/[^0-9]/g, "");
			if (!digits || digits === "0") {
				return { ok: false, error: "Threshold amount must be greater than 0" };
			}
			return {
				ok: true,
				config: { principal, assetIdentifier, thresholdAmount: digits },
			};
		}

		if (kind === "contract-deployment") {
			return { ok: true, config: { principal } };
		}

		if (kind === "print-event-match") {
			return {
				ok: true,
				config: {
					principal,
					topic: printTopic.trim() ? printTopic.trim() : null,
				},
			};
		}

		return { ok: false, error: "Unknown sentry kind" };
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSubmitting(true);

		const result = buildConfig();
		if (!result.ok) {
			setError(result.error);
			setSubmitting(false);
			return;
		}

		try {
			const res = await fetch(`${BROWSER_API_URL}/api/sentries`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					kind,
					name,
					config: result.config,
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

	const principalHint: Record<Kind, string> = {
		"large-outflow": "Alerts fire on any STX transfer to or from this address.",
		"permission-change": "Contract principal whose admin functions we watch.",
		"ft-outflow":
			"Principal involved in token transfers (sender or recipient).",
		"contract-deployment":
			"Principal (deployer address) we watch for new contract deployments.",
		"print-event-match": "Contract principal whose `print` events we watch.",
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
									{(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
										<option key={k} value={k}>
											{KIND_LABELS[k]}
										</option>
									))}
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
											: kind === "contract-deployment"
												? "SP... (deployer address)"
												: "SP....contract-name"
									}
									pattern="^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$"
								/>
								<div className="settings-hint">{principalHint[kind]}</div>
							</div>

							{kind === "large-outflow" && (
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
							)}

							{kind === "permission-change" && (
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

							{kind === "ft-outflow" && (
								<>
									<div className="settings-field">
										<label className="settings-label" htmlFor="sentry-asset-id">
											Asset identifier
										</label>
										<input
											id="sentry-asset-id"
											className="settings-input mono"
											required
											value={assetIdentifier}
											onChange={(e) => setAssetIdentifier(e.target.value)}
											placeholder="SP2...CONTRACT.token-name::token-symbol"
										/>
										<div className="settings-hint">
											SIP-010 asset identifier — the full
											<code> principal.contract::symbol</code> form.
										</div>
									</div>
									<div className="settings-field">
										<label
											className="settings-label"
											htmlFor="sentry-ft-threshold"
										>
											Threshold amount (raw, pre-decimal)
										</label>
										<input
											id="sentry-ft-threshold"
											className="settings-input"
											type="number"
											min="1"
											required
											value={thresholdAmount}
											onChange={(e) => setThresholdAmount(e.target.value)}
										/>
										<div className="settings-hint">
											Raw token amount. For a 6-decimal token, 1 million = 1.0
											token.
										</div>
									</div>
								</>
							)}

							{kind === "contract-deployment" && (
								<div className="settings-hint" style={{ marginTop: -8 }}>
									No extra config needed. Any contract deployment by the watched
									principal fires an alert.
								</div>
							)}

							{kind === "print-event-match" && (
								<div className="settings-field">
									<label className="settings-label" htmlFor="sentry-topic">
										Topic (optional)
									</label>
									<input
										id="sentry-topic"
										className="settings-input mono"
										value={printTopic}
										onChange={(e) => setPrintTopic(e.target.value)}
										placeholder="e.g. liquidation, pool-drain"
									/>
									<div className="settings-hint">
										If set, only prints with this exact topic match. Leave empty
										to match every print on the contract (noisy on chatty
										contracts).
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
