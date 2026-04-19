"use client";

import { useState } from "react";

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	storageUsedMb: number | null;
	apiUrl: string;
	trialEndsAt: string;
	suspendedAt: string | null;
	createdAt: string;
}

interface TenantRuntime {
	slug: string;
	plan: string;
	containers: Array<{
		name: string;
		state: string;
		cpuUsage?: number;
		memoryUsageBytes?: number;
		memoryLimitBytes?: number;
	}>;
	storageUsedMb?: number;
	storageLimitMb: number;
}

interface ProvisionResponse {
	tenant: TenantSummary;
	credentials: { apiUrl: string; anonKey: string; serviceKey: string };
}

const PLANS = [
	{
		id: "launch",
		name: "Launch",
		price: "$99/mo",
		specs: "1 vCPU · 2GB RAM · 10GB storage",
	},
	{
		id: "grow",
		name: "Grow",
		price: "$249/mo",
		specs: "2 vCPU · 4GB RAM · 50GB storage",
	},
	{
		id: "scale",
		name: "Scale",
		price: "$599/mo",
		specs: "4 vCPU · 8GB RAM · 200GB storage",
	},
] as const;

export function InstanceView({
	initialTenant,
	initialRuntime,
	sessionToken,
}: {
	initialTenant: TenantSummary | null;
	initialRuntime: TenantRuntime | null;
	sessionToken: string;
}) {
	const [tenant, setTenant] = useState(initialTenant);
	const [runtime, setRuntime] = useState(initialRuntime);

	if (!tenant) {
		return (
			<TrialStart
				sessionToken={sessionToken}
				onProvisioned={(resp) => {
					setTenant(resp.tenant);
					showCredsOnce(resp.credentials);
				}}
			/>
		);
	}

	return (
		<div className="instance-view">
			<TrialBanner tenant={tenant} />
			<div style={{ display: "grid", gap: 24 }}>
				<InstanceSummary tenant={tenant} />
				<ResourceGauges tenant={tenant} runtime={runtime} />
				<ConnectionSnippets tenant={tenant} />
				<ResizeSection
					currentPlan={tenant.plan}
					sessionToken={sessionToken}
					onResized={(updated) => {
						setTenant(updated);
						setRuntime(null);
					}}
				/>
			</div>
		</div>
	);
}

// ── Trial start (no tenant yet) ────────────────────────────────────────

function TrialStart({
	sessionToken,
	onProvisioned,
}: {
	sessionToken: string;
	onProvisioned: (resp: ProvisionResponse) => void;
}) {
	const [selected, setSelected] = useState<string>("launch");
	const [state, setState] = useState<"idle" | "provisioning" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleStart = async () => {
		setState("provisioning");
		setError(null);
		try {
			const res = await fetch("/api/tenants", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ plan: selected }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Provisioning failed (${res.status})`);
			}
			const data = (await res.json()) as ProvisionResponse;
			onProvisioned(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
			setState("error");
		}
	};

	return (
		<div>
			<h2 style={{ marginBottom: 8 }}>Start your 14-day trial</h2>
			<p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
				Pick a plan. We'll provision your dedicated Postgres + API + subgraph
				processor. You'll see credentials on the next screen.
			</p>
			<div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
				{PLANS.map((plan) => (
					<label
						key={plan.id}
						style={{
							display: "flex",
							gap: 12,
							alignItems: "center",
							padding: 16,
							borderRadius: 8,
							border:
								selected === plan.id
									? "2px solid var(--blue)"
									: "1px solid var(--border)",
							cursor: "pointer",
						}}
					>
						<input
							type="radio"
							name="plan"
							value={plan.id}
							checked={selected === plan.id}
							onChange={(e) => setSelected(e.target.value)}
						/>
						<div style={{ flex: 1 }}>
							<div style={{ fontWeight: 600 }}>{plan.name}</div>
							<div style={{ fontSize: 13, color: "var(--text-muted)" }}>
								{plan.specs}
							</div>
						</div>
						<div style={{ fontVariantNumeric: "tabular-nums" }}>
							{plan.price}
						</div>
					</label>
				))}
			</div>
			{error && (
				<div className="alert alert-error" style={{ marginBottom: 16 }}>
					{error}
				</div>
			)}
			<button
				type="button"
				className="btn btn-primary"
				onClick={handleStart}
				disabled={state === "provisioning"}
			>
				{state === "provisioning"
					? "Provisioning… (30-60s)"
					: "Start 14-Day Trial"}
			</button>
		</div>
	);
}

// ── Trial banner ───────────────────────────────────────────────────────

function TrialBanner({ tenant }: { tenant: TenantSummary }) {
	const trialEnd = new Date(tenant.trialEndsAt);
	const daysLeft = Math.ceil(
		(trialEnd.getTime() - Date.now()) / (24 * 3600 * 1000),
	);

	if (tenant.status === "suspended") {
		return (
			<div className="alert alert-error" style={{ marginBottom: 24 }}>
				<strong>Instance suspended.</strong> Upgrade to reactivate — data
				preserved for 30 days.
			</div>
		);
	}
	if (daysLeft <= 0) {
		return (
			<div className="alert alert-error" style={{ marginBottom: 24 }}>
				<strong>Trial expired.</strong> Upgrade to continue using this instance.
			</div>
		);
	}
	if (daysLeft <= 3) {
		return (
			<div className="alert alert-warning" style={{ marginBottom: 24 }}>
				Trial expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}.
			</div>
		);
	}
	return null;
}

// ── Summary ────────────────────────────────────────────────────────────

function InstanceSummary({ tenant }: { tenant: TenantSummary }) {
	return (
		<section>
			<h3>Instance</h3>
			<table className="kv-table">
				<tbody>
					<tr>
						<td>Slug</td>
						<td>
							<code>{tenant.slug}</code>
						</td>
					</tr>
					<tr>
						<td>Plan</td>
						<td>
							{tenant.plan} · {tenant.cpus} vCPU · {tenant.memoryMb}MB RAM ·{" "}
							{tenant.storageLimitMb >= 0
								? `${tenant.storageLimitMb}MB storage`
								: "unlimited storage"}
						</td>
					</tr>
					<tr>
						<td>Status</td>
						<td>{tenant.status}</td>
					</tr>
					<tr>
						<td>Created</td>
						<td>{new Date(tenant.createdAt).toLocaleString()}</td>
					</tr>
				</tbody>
			</table>
		</section>
	);
}

// ── Resource gauges ────────────────────────────────────────────────────

function ResourceGauges({
	tenant,
	runtime,
}: {
	tenant: TenantSummary;
	runtime: TenantRuntime | null;
}) {
	if (!runtime) {
		return (
			<section>
				<h3>Resource usage</h3>
				<p style={{ color: "var(--text-muted)" }}>
					Live stats unavailable (provisioner not reachable yet).
				</p>
			</section>
		);
	}

	const totalMem = runtime.containers.reduce(
		(s, c) => s + (c.memoryUsageBytes ?? 0),
		0,
	);
	const totalLimit = runtime.containers.reduce(
		(s, c) => s + (c.memoryLimitBytes ?? 0),
		0,
	);
	const memPct = totalLimit > 0 ? (totalMem / totalLimit) * 100 : 0;

	const storagePct =
		tenant.storageLimitMb > 0 && runtime.storageUsedMb != null
			? (runtime.storageUsedMb / tenant.storageLimitMb) * 100
			: 0;

	const avgCpu =
		runtime.containers.length > 0
			? runtime.containers.reduce((s, c) => s + (c.cpuUsage ?? 0), 0) /
				runtime.containers.length
			: 0;
	const cpuPct = Math.min(100, avgCpu * 100);

	return (
		<section>
			<h3>Resource usage</h3>
			<div style={{ display: "grid", gap: 12 }}>
				<Gauge label="CPU" pct={cpuPct} />
				<Gauge
					label="Memory"
					pct={memPct}
					caption={`${formatMb(totalMem / 1024 / 1024)} / ${formatMb(totalLimit / 1024 / 1024)}`}
				/>
				<Gauge
					label="Storage"
					pct={storagePct}
					caption={
						runtime.storageUsedMb != null
							? `${runtime.storageUsedMb}MB / ${tenant.storageLimitMb}MB`
							: "—"
					}
				/>
			</div>
			{(memPct > 80 || storagePct > 80) && (
				<div className="alert alert-warning" style={{ marginTop: 16 }}>
					Approaching your plan limits. Consider resizing below.
				</div>
			)}
		</section>
	);
}

function Gauge({
	label,
	pct,
	caption,
}: {
	label: string;
	pct: number;
	caption?: string;
}) {
	const color =
		pct > 90 ? "var(--red)" : pct > 80 ? "var(--yellow)" : "var(--blue)";
	return (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between" }}>
				<span>{label}</span>
				<span style={{ color: "var(--text-muted)" }}>
					{caption ?? `${pct.toFixed(1)}%`}
				</span>
			</div>
			<div
				style={{
					height: 6,
					background: "var(--bg-subtle)",
					borderRadius: 3,
					overflow: "hidden",
					marginTop: 4,
				}}
			>
				<div
					style={{
						height: "100%",
						width: `${Math.min(100, pct)}%`,
						background: color,
						transition: "width 0.3s",
					}}
				/>
			</div>
		</div>
	);
}

function formatMb(mb: number): string {
	if (mb < 1024) return `${mb.toFixed(0)}MB`;
	return `${(mb / 1024).toFixed(1)}GB`;
}

// ── Connection snippets ───────────────────────────────────────────────

function ConnectionSnippets({ tenant }: { tenant: TenantSummary }) {
	const [tab, setTab] = useState<"curl" | "node" | "cli">("curl");

	const snippet = {
		curl: `curl -H "Authorization: Bearer \$SL_SERVICE_KEY" \\
  ${tenant.apiUrl}/api/subgraphs`,
		node: `import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiUrl: "${tenant.apiUrl}",
  apiKey: process.env.SL_SERVICE_KEY,
});

const { data } = await sl.subgraphs.list();`,
		cli: `sl instance connect ${tenant.apiUrl} --key \$SL_SERVICE_KEY
sl subgraphs deploy ./my-subgraph.ts`,
	}[tab];

	return (
		<section>
			<h3>Connect</h3>
			<p style={{ color: "var(--text-muted)", marginBottom: 8 }}>
				Your API: <code>{tenant.apiUrl}</code>
			</p>
			<div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
				{(["curl", "node", "cli"] as const).map((t) => (
					<button
						type="button"
						key={t}
						onClick={() => setTab(t)}
						style={{
							padding: "4px 10px",
							borderRadius: 4,
							background: tab === t ? "var(--bg-subtle)" : "transparent",
							border: "1px solid var(--border)",
						}}
					>
						{t}
					</button>
				))}
			</div>
			<CodeBlock code={snippet} />
			<p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>
				Your service key was shown once at provision time. Regenerate at any
				time from this page — the old one stops working immediately.
			</p>
		</section>
	);
}

function CodeBlock({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div style={{ position: "relative" }}>
			<pre
				style={{
					background: "var(--code-bg)",
					padding: 12,
					borderRadius: 4,
					overflow: "auto",
					fontSize: 13,
				}}
			>
				<code>{code}</code>
			</pre>
			<button
				type="button"
				onClick={handleCopy}
				style={{
					position: "absolute",
					top: 8,
					right: 8,
					padding: "2px 8px",
					fontSize: 12,
				}}
			>
				{copied ? "copied" : "copy"}
			</button>
		</div>
	);
}

// ── Resize ─────────────────────────────────────────────────────────────

function ResizeSection({
	currentPlan,
	sessionToken,
	onResized,
}: {
	currentPlan: string;
	sessionToken: string;
	onResized: (tenant: TenantSummary) => void;
}) {
	const [target, setTarget] = useState<string>(currentPlan);
	const [state, setState] = useState<"idle" | "resizing" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleResize = async () => {
		if (target === currentPlan) return;
		setState("resizing");
		setError(null);
		try {
			const res = await fetch("/api/tenants/me/resize", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ plan: target }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Resize failed (${res.status})`);
			}
			const data = (await res.json()) as { tenant: TenantSummary };
			onResized(data.tenant);
			setState("idle");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
			setState("error");
		}
	};

	return (
		<section>
			<h3>Resize</h3>
			<p style={{ color: "var(--text-muted)" }}>
				Changes container limits. Brief downtime (~30s) — data preserved.
			</p>
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<select
					value={target}
					onChange={(e) => setTarget(e.target.value)}
					disabled={state === "resizing"}
				>
					{PLANS.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name} — {p.price} ({p.specs})
						</option>
					))}
				</select>
				<button
					type="button"
					className="btn"
					onClick={handleResize}
					disabled={target === currentPlan || state === "resizing"}
				>
					{state === "resizing" ? "Resizing…" : "Apply"}
				</button>
			</div>
			{error && (
				<div className="alert alert-error" style={{ marginTop: 8 }}>
					{error}
				</div>
			)}
		</section>
	);
}

// ── One-time credential display ───────────────────────────────────────

function showCredsOnce(creds: {
	apiUrl: string;
	anonKey: string;
	serviceKey: string;
}): void {
	// Show the credentials via a window-scoped object the page can read on
	// next render. We don't persist them — user has to copy now.
	// TODO: replace with a modal; for v1 this is just console + localStorage
	// so they're accessible for the first minute after provision.
	if (typeof window !== "undefined") {
		window.sessionStorage.setItem(
			"sl.creds.oneshot",
			JSON.stringify({ ...creds, ts: Date.now() }),
		);
	}
	console.log("[secondlayer] Provision complete. Credentials:", creds);
}
