import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import Link from "next/link";
import { notFound } from "next/navigation";
import SentryActions from "./actions";

interface SentryDetail {
	sentry: {
		id: string;
		kind: string;
		name: string;
		config: Record<string, unknown>;
		active: boolean;
		last_check_at: string | null;
		delivery_webhook: string;
		created_at: string;
	};
	alerts: Array<{
		id: string;
		fired_at: string;
		delivery_status: string;
		delivery_error: string | null;
		payload: {
			triage?: { severity: string; summary: string; likelyCause: string };
			match?: Record<string, unknown>;
		};
	}>;
}

interface RunRow {
	id: string;
	workflowName: string;
	status: string;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	durationMs: number | null;
	stepCount: number;
}

function formatDate(ts: string | null): string {
	if (!ts) return "never";
	return new Date(ts).toLocaleString();
}

function maskWebhook(url: string): string {
	try {
		const u = new URL(url);
		return `${u.origin}${u.pathname.slice(0, 12)}…`;
	} catch {
		return `${url.slice(0, 30)}…`;
	}
}

export default async function SentryDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	const [data, runsResp] = await Promise.all([
		apiRequest<SentryDetail>(`/api/sentries/${id}`, {
			sessionToken: session,
			tags: ["sentries", id],
		}).catch(() => null),
		apiRequest<{ data: RunRow[] }>(`/api/sentries/${id}/runs`, {
			sessionToken: session,
			tags: ["sentries", id, "runs"],
		}).catch(() => ({ data: [] as RunRow[] })),
	]);

	if (!data) notFound();
	const { sentry, alerts } = data;
	const runs = runsResp.data;

	return (
		<>
			<OverviewTopbar page={sentry.name} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner" style={{ maxWidth: 900 }}>
					<div style={{ marginBottom: 12 }}>
						<Link
							href="/sentries"
							style={{ fontSize: 13, color: "var(--fg-muted)" }}
						>
							← All sentries
						</Link>
					</div>

					<div
						style={{
							display: "flex",
							alignItems: "flex-start",
							justifyContent: "space-between",
							marginBottom: 16,
						}}
					>
						<div>
							<h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
								{sentry.name}{" "}
								<span
									className={`badge ${sentry.active ? "active" : ""}`}
									style={{ marginLeft: 8, fontSize: 12 }}
								>
									{sentry.active ? "Active" : "Paused"}
								</span>
							</h1>
							<div
								style={{
									fontSize: 13,
									color: "var(--fg-muted)",
									marginTop: 4,
								}}
							>
								<code>{sentry.kind}</code> · created{" "}
								{formatDate(sentry.created_at)}
							</div>
						</div>
						<SentryActions sentryId={sentry.id} active={sentry.active} />
					</div>

					<section
						style={{
							border: "1px solid var(--border)",
							borderRadius: 6,
							padding: 16,
							marginBottom: 24,
						}}
					>
						<h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
							Configuration
						</h2>
						<dl style={{ fontSize: 13 }}>
							<div style={{ display: "flex", marginBottom: 6 }}>
								<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
									Principal
								</dt>
								<dd style={{ margin: 0 }}>
									<code>{String(sentry.config.principal ?? "—")}</code>
								</dd>
							</div>
							{sentry.kind === "large-outflow" && (
								<div style={{ display: "flex", marginBottom: 6 }}>
									<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
										Threshold
									</dt>
									<dd style={{ margin: 0 }}>
										<code>
											{String(sentry.config.thresholdMicroStx ?? "—")}
										</code>{" "}
										µSTX
									</dd>
								</div>
							)}
							{sentry.kind === "permission-change" && (
								<div style={{ display: "flex", marginBottom: 6 }}>
									<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
										Admin functions
									</dt>
									<dd style={{ margin: 0 }}>
										<code>
											{Array.isArray(sentry.config.adminFunctions)
												? (sentry.config.adminFunctions as string[]).join(", ")
												: "—"}
										</code>
									</dd>
								</div>
							)}
							{sentry.kind === "ft-outflow" && (
								<>
									<div style={{ display: "flex", marginBottom: 6 }}>
										<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
											Asset
										</dt>
										<dd style={{ margin: 0 }}>
											<code>
												{String(sentry.config.assetIdentifier ?? "—")}
											</code>
										</dd>
									</div>
									<div style={{ display: "flex", marginBottom: 6 }}>
										<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
											Threshold
										</dt>
										<dd style={{ margin: 0 }}>
											<code>
												{String(sentry.config.thresholdAmount ?? "—")}
											</code>
										</dd>
									</div>
								</>
							)}
							{sentry.kind === "print-event-match" && (
								<div style={{ display: "flex", marginBottom: 6 }}>
									<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
										Topic
									</dt>
									<dd style={{ margin: 0 }}>
										<code>
											{sentry.config.topic
												? String(sentry.config.topic)
												: "(any)"}
										</code>
									</dd>
								</div>
							)}
							<div style={{ display: "flex", marginBottom: 6 }}>
								<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
									Delivery
								</dt>
								<dd style={{ margin: 0 }}>
									<code>{maskWebhook(sentry.delivery_webhook)}</code>
								</dd>
							</div>
							<div style={{ display: "flex" }}>
								<dt style={{ minWidth: 140, color: "var(--fg-muted)" }}>
									Last check
								</dt>
								<dd style={{ margin: 0 }}>
									{formatDate(sentry.last_check_at)}
								</dd>
							</div>
						</dl>
					</section>

					<section>
						<h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
							Alert history
						</h2>
						{alerts.length === 0 ? (
							<div
								style={{
									padding: 20,
									border: "1px dashed var(--border)",
									borderRadius: 6,
									textAlign: "center",
									fontSize: 13,
									color: "var(--fg-muted)",
								}}
							>
								No alerts yet. Click "Send test alert" above to verify your
								webhook.
							</div>
						) : (
							<div
								style={{
									border: "1px solid var(--border)",
									borderRadius: 6,
									overflow: "hidden",
								}}
							>
								{alerts.map((a) => (
									<div
										key={a.id}
										style={{
											padding: 12,
											borderBottom: "1px solid var(--border)",
											display: "flex",
											gap: 12,
											alignItems: "flex-start",
										}}
									>
										<span
											className="badge"
											style={{
												fontSize: 11,
												textTransform: "uppercase",
											}}
										>
											{a.payload.triage?.severity ?? "—"}
										</span>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: 13, fontWeight: 500 }}>
												{a.payload.triage?.summary ?? "Alert"}
											</div>
											<div
												style={{
													fontSize: 11,
													color: "var(--fg-muted)",
													marginTop: 2,
												}}
											>
												{formatDate(a.fired_at)} · delivery:{" "}
												<code>{a.delivery_status}</code>
												{a.delivery_error ? ` · ${a.delivery_error}` : ""}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<section style={{ marginTop: 24 }}>
						<h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
							Recent runs
						</h2>
						{runs.length === 0 ? (
							<div
								style={{
									padding: 20,
									border: "1px dashed var(--border)",
									borderRadius: 6,
									textAlign: "center",
									fontSize: 13,
									color: "var(--fg-muted)",
								}}
							>
								No runs yet. Runs appear here after the next tick, or click
								"Send test alert" above.
							</div>
						) : (
							<div
								style={{
									border: "1px solid var(--border)",
									borderRadius: 6,
									overflow: "hidden",
								}}
							>
								{runs.map((r) => (
									<Link
										key={r.id}
										href={`/sentries/${id}/runs/${r.id}`}
										className="index-row"
										style={{ padding: 12 }}
									>
										<div className="index-row-main">
											<div className="index-row-name">
												<span
													className={`badge ${runStatusClass(r.status)}`}
													style={{ marginRight: 8 }}
												>
													{r.status}
												</span>
												<code style={{ fontSize: 12 }}>{r.id.slice(0, 8)}</code>
											</div>
											<div
												className="index-row-desc"
												style={{ fontSize: 11, color: "var(--fg-muted)" }}
											>
												{formatDate(r.createdAt)} ·{" "}
												{r.durationMs != null
													? `${(r.durationMs / 1000).toFixed(1)}s`
													: "—"}{" "}
												· {r.stepCount} step{r.stepCount === 1 ? "" : "s"}
											</div>
										</div>
									</Link>
								))}
							</div>
						)}
					</section>
				</div>
			</div>
		</>
	);
}

function runStatusClass(status: string): string {
	if (status === "completed") return "active";
	if (status === "failed") return "danger";
	return "";
}
