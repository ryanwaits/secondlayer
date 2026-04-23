"use client";

import type { SubgraphSummary } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const FORMATS = [
	{ value: "standard-webhooks", label: "Standard Webhooks" },
	{ value: "inngest", label: "Inngest" },
	{ value: "trigger", label: "Trigger.dev" },
	{ value: "cloudflare", label: "Cloudflare Workflows" },
	{ value: "cloudevents", label: "CloudEvents" },
	{ value: "raw", label: "Raw JSON" },
];

const RUNTIMES = [
	{ value: "", label: "—" },
	{ value: "inngest", label: "Inngest" },
	{ value: "trigger", label: "Trigger.dev" },
	{ value: "cloudflare", label: "Cloudflare" },
	{ value: "node", label: "Node" },
];

type Reach = "idle" | "checking" | "reachable" | "unreachable";

export function NewSubscriptionForm({
	subgraphs,
}: {
	subgraphs: SubgraphSummary[];
}) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [subgraphName, setSubgraphName] = useState(subgraphs[0]?.name ?? "");
	const [tableName, setTableName] = useState("");
	const [format, setFormat] = useState<string>("standard-webhooks");
	const [runtime, setRuntime] = useState<string>("");
	const [url, setUrl] = useState("");
	const [reach, setReach] = useState<Reach>("idle");
	const [submitting, setSubmitting] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [secret, setSecret] = useState<string | null>(null);
	const [createdId, setCreatedId] = useState<string | null>(null);

	const tableOptions = useMemo(() => {
		const sg = subgraphs.find((s) => s.name === subgraphName);
		return sg?.tables ?? [];
	}, [subgraphName, subgraphs]);

	async function checkReach(u: string) {
		if (!u.startsWith("http")) {
			setReach("idle");
			return;
		}
		setReach("checking");
		try {
			const res = await fetch("/api/subscriptions/check-url", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: u }),
			});
			const body = (await res.json()) as { reachable: boolean };
			setReach(body.reachable ? "reachable" : "unreachable");
		} catch {
			setReach("unreachable");
		}
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setErr(null);
		setSubmitting(true);
		try {
			const res = await fetch("/api/subscriptions", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					subgraphName,
					tableName,
					url,
					format,
					runtime: runtime || null,
				}),
			});
			const body = (await res.json()) as {
				error?: string;
				subscription?: { id: string };
				signingSecret?: string;
			};
			if (!res.ok) {
				setErr(body.error ?? `HTTP ${res.status}`);
				setSubmitting(false);
				return;
			}
			setSecret(body.signingSecret ?? null);
			setCreatedId(body.subscription?.id ?? null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
			setSubmitting(false);
		}
	}

	if (secret && createdId) {
		return (
			<div className="detail-section">
				<h2>Subscription created</h2>
				<p className="detail-desc">
					Copy your signing secret now — it won't be shown again. Store it
					wherever your webhook receiver runs.
				</p>
				<code
					style={{
						display: "block",
						padding: 12,
						background: "var(--code-bg)",
						wordBreak: "break-all",
					}}
				>
					{secret}
				</code>
				<div style={{ marginTop: 24, display: "flex", gap: 8 }}>
					<button
						type="button"
						className="btn-primary"
						onClick={() => router.push(`/subscriptions/${createdId}`)}
					>
						Go to subscription
					</button>
					<button
						type="button"
						className="btn-secondary"
						onClick={() => router.push("/subscriptions")}
					>
						Back to list
					</button>
				</div>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} className="detail-section">
			<h2>New subscription</h2>

			<label className="form-field">
				<span>Name</span>
				<input
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="whale-alerts"
				/>
			</label>

			<label className="form-field">
				<span>Subgraph</span>
				<select
					required
					value={subgraphName}
					onChange={(e) => {
						setSubgraphName(e.target.value);
						setTableName("");
					}}
				>
					<option value="">Select a subgraph</option>
					{subgraphs.map((s) => (
						<option key={s.name} value={s.name}>
							{s.name}
						</option>
					))}
				</select>
			</label>

			<label className="form-field">
				<span>Table</span>
				{tableOptions.length > 0 ? (
					<select
						required
						value={tableName}
						onChange={(e) => setTableName(e.target.value)}
					>
						<option value="">Select a table</option>
						{tableOptions.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				) : (
					<input
						required
						value={tableName}
						onChange={(e) => setTableName(e.target.value)}
						placeholder="transfers"
					/>
				)}
			</label>

			<label className="form-field">
				<span>Format</span>
				<select value={format} onChange={(e) => setFormat(e.target.value)}>
					{FORMATS.map((f) => (
						<option key={f.value} value={f.value}>
							{f.label}
						</option>
					))}
				</select>
			</label>

			<label className="form-field">
				<span>Runtime</span>
				<select value={runtime} onChange={(e) => setRuntime(e.target.value)}>
					{RUNTIMES.map((r) => (
						<option key={r.value} value={r.value}>
							{r.label}
						</option>
					))}
				</select>
			</label>

			<label className="form-field">
				<span>Webhook URL</span>
				<input
					required
					type="url"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					onBlur={(e) => checkReach(e.target.value)}
					placeholder="https://"
				/>
				{reach === "checking" && (
					<small className="form-hint">Checking reachability…</small>
				)}
				{reach === "reachable" && (
					<small className="form-hint" style={{ color: "var(--success)" }}>
						✓ reachable
					</small>
				)}
				{reach === "unreachable" && (
					<small className="form-hint" style={{ color: "var(--warning)" }}>
						⚠ URL did not respond within 30s — saving anyway, confirm the
						endpoint is correct
					</small>
				)}
			</label>

			{err && <p style={{ color: "var(--error)" }}>{err}</p>}

			<div style={{ marginTop: 16, display: "flex", gap: 8 }}>
				<button type="submit" disabled={submitting} className="btn-primary">
					{submitting ? "Creating…" : "Create subscription"}
				</button>
				<button
					type="button"
					className="btn-secondary"
					onClick={() => router.back()}
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
