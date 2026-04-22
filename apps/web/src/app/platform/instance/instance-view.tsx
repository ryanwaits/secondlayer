"use client";

import { useEffect, useState } from "react";
import { DangerZone } from "./danger-zone";
import { DbAccessSection } from "./db-access";
import { KeyRevealModal } from "./key-reveal-modal";
import { ProvisionProgress } from "./provision-progress";
import { type ProvisionResponse, ProvisionStart } from "./provision-start";

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	storageUsedMb: number | null;
	apiUrl: string;
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

type RotateType = "service" | "anon" | "both";

interface RevealedKeys {
	title: string;
	subtitle: string;
	keys: Array<{ label: string; value: string }>;
}

export function InstanceView({
	initialTenant,
	initialRuntime,
	sessionToken,
}: {
	initialTenant: TenantSummary | null;
	initialRuntime: TenantRuntime | null;
	sessionToken: string;
}) {
	const [tenant, setTenant] = useState<TenantSummary | null>(initialTenant);
	const [runtime, setRuntime] = useState<TenantRuntime | null>(initialRuntime);
	const [provisioningView, setProvisioningView] = useState(false);
	const [reveal, setReveal] = useState<RevealedKeys | null>(null);

	// Poll /api/tenants/me every 5s while the tenant is active (or while
	// provisioning) — keeps resource gauges live.
	useEffect(() => {
		if (!tenant) return;
		const t = setInterval(async () => {
			try {
				const res = await fetch("/api/tenants/me", {
					headers: { Authorization: `Bearer ${sessionToken}` },
				});
				if (!res.ok) return;
				const data = (await res.json()) as {
					tenant: TenantSummary;
					runtime: TenantRuntime | null;
				};
				setTenant(data.tenant);
				setRuntime(data.runtime ?? null);
			} catch {}
		}, 5000);
		return () => clearInterval(t);
	}, [tenant, sessionToken]);

	if (provisioningView && !tenant) {
		return <ProvisionProgress />;
	}

	if (!tenant) {
		return (
			<ProvisionStart
				sessionToken={sessionToken}
				onProvisioning={() => setProvisioningView(true)}
				onProvisioned={(resp: ProvisionResponse) => {
					setProvisioningView(false);
					// Show credentials once. Synthesize the tenant summary shape
					// from the provision response; next poll will fill in the rest.
					setTenant({
						slug: resp.tenant.slug,
						plan: resp.tenant.plan,
						status: "active",
						cpus: 0,
						memoryMb: 0,
						storageLimitMb: 0,
						storageUsedMb: null,
						apiUrl: resp.tenant.apiUrl,
						suspendedAt: null,
						createdAt: new Date().toISOString(),
					});
					setReveal({
						title: "Save your keys",
						subtitle:
							"These are shown once. Store them in your password manager before dismissing.",
						keys: [
							{
								label: "Service key · full access",
								value: resp.credentials.serviceKey,
							},
							{
								label: "Anon key · read-only",
								value: resp.credentials.anonKey,
							},
							{ label: "API URL", value: resp.credentials.apiUrl },
						],
					});
				}}
			/>
		);
	}

	return (
		<>
			<ActiveView
				tenant={tenant}
				runtime={runtime}
				sessionToken={sessionToken}
				onResized={(updated) => {
					setTenant(updated);
					setRuntime(null);
				}}
				onKeyRotated={(type, rotated) => {
					const keys: Array<{ label: string; value: string }> = [];
					if (rotated.serviceKey) {
						keys.push({ label: "New service key", value: rotated.serviceKey });
					}
					if (rotated.anonKey) {
						keys.push({ label: "New anon key", value: rotated.anonKey });
					}
					setReveal({
						title:
							type === "both"
								? "Keys rotated"
								: `${capitalize(type)} key rotated`,
						subtitle:
							"The previous key(s) are now invalid. Update any deployed integrations with the new value below.",
						keys,
					});
				}}
				onSuspended={() => {
					// Poll will pick up the new status.
				}}
				onDeleted={() => {
					setTenant(null);
					setRuntime(null);
				}}
			/>

			{reveal && (
				<KeyRevealModal
					title={reveal.title}
					subtitle={reveal.subtitle}
					warning="Shown once. We can't retrieve these later — rotate if lost."
					keys={reveal.keys}
					gateLabel="I've saved these securely"
					onDismiss={() => setReveal(null)}
				/>
			)}
		</>
	);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Active view (tenant exists) ─────────────────────────────────────

function ActiveView({
	tenant,
	runtime,
	sessionToken,
	onResized,
	onKeyRotated,
	onSuspended,
	onDeleted,
}: {
	tenant: TenantSummary;
	runtime: TenantRuntime | null;
	sessionToken: string;
	onResized: (updated: TenantSummary) => void;
	onKeyRotated: (
		type: RotateType,
		rotated: { serviceKey?: string; anonKey?: string },
	) => void;
	onSuspended: () => void;
	onDeleted: () => void;
}) {
	return (
		<>
			<h1 className="settings-title">Instance</h1>
			<p className="settings-desc">
				{tenant.status === "suspended"
					? tenant.plan === "hobby"
						? "Paused after 7 days idle. Data preserved. The next CLI command auto-resumes, or click Resume below."
						: "Containers stopped. Data preserved. Resume to bring everything back online in ~20s."
					: "Your dedicated Postgres, API, and subgraph processor."}
			</p>

			<OverviewSection tenant={tenant} />
			<ResourceGauges tenant={tenant} runtime={runtime} />
			<ConnectSection tenant={tenant} />
			<KeysSection sessionToken={sessionToken} onKeyRotated={onKeyRotated} />
			{tenant.status !== "suspended" && (
				<DbAccessSection sessionToken={sessionToken} />
			)}
			<ResizeSection
				currentPlan={tenant.plan}
				sessionToken={sessionToken}
				onResized={onResized}
			/>

			<div className="settings-divider" />

			<DangerZone
				slug={tenant.slug}
				status={tenant.status}
				sessionToken={sessionToken}
				onSuspended={onSuspended}
				onDeleted={onDeleted}
				onRotateAll={() => rotateKeys("both", sessionToken, onKeyRotated)}
			/>
		</>
	);
}

// ─── Overview ────────────────────────────────────────────────────────

function OverviewSection({ tenant }: { tenant: TenantSummary }) {
	return (
		<section className="settings-section">
			<div className="settings-section-title">Overview</div>
			<div className="instance-kv">
				<div className="row">
					<div className="key">url</div>
					<div className="val mono">{tenant.apiUrl}</div>
				</div>
				<div className="row">
					<div className="key">plan</div>
					<div className="val">
						{capitalize(tenant.plan)} · {tenant.cpus} vCPU · {tenant.memoryMb}MB
						RAM · {formatMb(tenant.storageLimitMb)} storage
					</div>
				</div>
				<div className="row">
					<div className="key">status</div>
					<div className="val">
						<StatusPill status={tenant.status} />
					</div>
				</div>
				<div className="row">
					<div className="key">created</div>
					<div className="val">
						{new Date(tenant.createdAt).toLocaleString()}
					</div>
				</div>
			</div>
		</section>
	);
}

function StatusPill({ status }: { status: string }) {
	const variant =
		status === "active"
			? "pill-success"
			: status === "suspended"
				? "pill-muted"
				: "pill-warn";
	return (
		<span className={`pill ${variant}`}>
			<span className="dot" />
			{status}
		</span>
	);
}

// ─── Resource gauges ─────────────────────────────────────────────────

function ResourceGauges({
	tenant,
	runtime,
}: {
	tenant: TenantSummary;
	runtime: TenantRuntime | null;
}) {
	if (!runtime || runtime.containers.length === 0) {
		return (
			<section className="settings-section">
				<div className="settings-section-title">Resource usage</div>
				<div className="instance-gauge-empty">
					<span className="pulse" />
					Awaiting first metrics…
				</div>
			</section>
		);
	}

	const avgCpu =
		runtime.containers.reduce((s, c) => s + (c.cpuUsage ?? 0), 0) /
		runtime.containers.length;
	const cpuPct = Math.min(100, avgCpu * 100);

	const totalMem = runtime.containers.reduce(
		(s, c) => s + (c.memoryUsageBytes ?? 0),
		0,
	);
	const totalMemLimit = runtime.containers.reduce(
		(s, c) => s + (c.memoryLimitBytes ?? 0),
		0,
	);
	const memPct = totalMemLimit > 0 ? (totalMem / totalMemLimit) * 100 : 0;

	const storagePct =
		tenant.storageLimitMb > 0 && runtime.storageUsedMb != null
			? (runtime.storageUsedMb / tenant.storageLimitMb) * 100
			: 0;

	return (
		<section className="settings-section">
			<div className="settings-section-title">Resource usage</div>
			<Gauge label="CPU" pct={cpuPct} caption={`${cpuPct.toFixed(0)}%`} />
			<Gauge
				label="Memory"
				pct={memPct}
				caption={`${formatBytes(totalMem)} / ${formatBytes(totalMemLimit)}`}
			/>
			<Gauge
				label="Storage"
				pct={storagePct}
				caption={
					runtime.storageUsedMb != null
						? `${formatMb(runtime.storageUsedMb)} / ${formatMb(tenant.storageLimitMb)}`
						: "—"
				}
			/>
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
	caption: string;
}) {
	const variant = pct >= 90 ? "danger" : pct >= 80 ? "warn" : "";
	return (
		<div className={`instance-gauge${variant ? ` ${variant}` : ""}`}>
			<div className="label">{label}</div>
			<div className="bar">
				<div className="fill" style={{ width: `${Math.min(100, pct)}%` }} />
			</div>
			<div className="caption">{caption}</div>
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1) return `${gb.toFixed(1)} GB`;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)} MB`;
}

function formatMb(mb: number): string {
	if (mb < 0) return "unlimited";
	const gb = mb / 1024;
	if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
	return `${mb.toFixed(0)} MB`;
}

// ─── Connect ─────────────────────────────────────────────────────────

type ConnectTab = "curl" | "node" | "cli";

function ConnectSection({ tenant }: { tenant: TenantSummary }) {
	const [tab, setTab] = useState<ConnectTab>("curl");
	const [copied, setCopied] = useState(false);

	const snippet = {
		curl: `curl -H "Authorization: Bearer $SL_SERVICE_KEY" \\
  ${tenant.apiUrl}/api/subgraphs`,
		node: `import { createClient } from "@secondlayer/sdk";

const sl = createClient({
  apiUrl: "${tenant.apiUrl}",
  apiKey: process.env.SL_SERVICE_KEY,
});

const { data } = await sl.subgraphs.list();`,
		cli: `sl login
sl project use ${tenant.slug}
sl subgraphs deploy ./my-subgraph.ts`,
	}[tab];

	const handleCopyUrl = async () => {
		await navigator.clipboard.writeText(tenant.apiUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<section className="settings-section">
			<div className="settings-section-title">Connect</div>
			<div className="connect-url">
				<span className="url">{tenant.apiUrl}</span>
				<button type="button" className="copy-btn" onClick={handleCopyUrl}>
					{copied ? "copied" : "copy"}
				</button>
			</div>
			<div className="connect-tabs">
				{(["curl", "node", "cli"] as const).map((t) => (
					<button
						type="button"
						key={t}
						className={`connect-tab${tab === t ? " active" : ""}`}
						onClick={() => setTab(t)}
					>
						{t}
					</button>
				))}
			</div>
			<pre className="connect-code">{snippet}</pre>
		</section>
	);
}

// ─── Keys ────────────────────────────────────────────────────────────

function KeysSection({
	sessionToken,
	onKeyRotated,
}: {
	sessionToken: string;
	onKeyRotated: (
		type: RotateType,
		rotated: { serviceKey?: string; anonKey?: string },
	) => void;
}) {
	const [rotating, setRotating] = useState<RotateType | null>(null);

	const handleRotate = async (type: RotateType) => {
		if (rotating) return;
		setRotating(type);
		try {
			await rotateKeys(type, sessionToken, onKeyRotated);
		} finally {
			setRotating(null);
		}
	};

	return (
		<section className="settings-section">
			<div className="settings-section-title">Keys</div>
			<div className="settings-key-row">
				<div className="key-meta">
					<div className="key-name">Service key</div>
					<div className="key-hint">
						Full access — server-side only. <code>Bearer $SL_SERVICE_KEY</code>
					</div>
				</div>
				<button
					type="button"
					className="settings-btn ghost small"
					onClick={() => handleRotate("service")}
					disabled={rotating !== null}
				>
					{rotating === "service" ? "Rotating…" : "Rotate"}
				</button>
			</div>
			<div className="settings-key-row">
				<div className="key-meta">
					<div className="key-name">Anon key</div>
					<div className="key-hint">
						Read-only — safe to embed in client code.
					</div>
				</div>
				<button
					type="button"
					className="settings-btn ghost small"
					onClick={() => handleRotate("anon")}
					disabled={rotating !== null}
				>
					{rotating === "anon" ? "Rotating…" : "Rotate"}
				</button>
			</div>
			<div className="settings-hint">
				Rotating invalidates the old key immediately. The new one is shown once.
			</div>
		</section>
	);
}

async function rotateKeys(
	type: RotateType,
	sessionToken: string,
	onDone: (
		type: RotateType,
		rotated: { serviceKey?: string; anonKey?: string },
	) => void,
) {
	const res = await fetch("/api/tenants/me/keys/rotate", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ type }),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `Rotate failed (${res.status})`);
	}
	const data = (await res.json()) as {
		type: RotateType;
		rotated: { serviceKey?: string; anonKey?: string };
	};
	onDone(data.type, data.rotated);
}

// ─── Resize ─────────────────────────────────────────────────────────

function ResizeSection({
	currentPlan,
	sessionToken,
	onResized,
}: {
	currentPlan: string;
	sessionToken: string;
	onResized: (tenant: TenantSummary) => void;
}) {
	const RESIZE_OPTIONS = ["hobby", "launch", "grow", "scale"];
	const [target, setTarget] = useState<string>(
		RESIZE_OPTIONS.includes(currentPlan) ? currentPlan : "hobby",
	);
	const [state, setState] = useState<
		"idle" | "confirming" | "resizing" | "error"
	>("idle");
	const [error, setError] = useState<string | null>(null);

	const handleApply = async () => {
		if (target === currentPlan) return;
		setState("confirming");
	};

	const handleConfirm = async () => {
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
		} catch (e) {
			setError(e instanceof Error ? e.message : "Resize failed");
			setState("error");
		}
	};

	return (
		<section className="settings-section">
			<div className="settings-section-title">Resize</div>
			{state === "confirming" ? (
				<>
					<div className="instance-banner warning" style={{ marginBottom: 12 }}>
						<span className="banner-dot" />
						<div className="banner-body">
							<strong>
								Resize {currentPlan} → {target}?
							</strong>{" "}
							Brief downtime (~30s) while containers recreate. Data is
							preserved.
						</div>
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							type="button"
							className="settings-btn primary small"
							onClick={handleConfirm}
						>
							Confirm resize
						</button>
						<button
							type="button"
							className="settings-btn ghost small"
							onClick={() => setState("idle")}
						>
							Cancel
						</button>
					</div>
				</>
			) : (
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<select
						className="settings-input"
						value={target}
						onChange={(e) => setTarget(e.target.value)}
						style={{ flex: 1, maxWidth: 320, height: 34 }}
						disabled={state === "resizing"}
					>
						<option value="hobby">
							Hobby — free (0.5 vCPU · 512 MB · 5 GB · auto-pauses after 7d
							idle)
						</option>
						<option value="launch">
							Launch — $99/mo (1 vCPU · 2 GB · 10 GB)
						</option>
						<option value="grow">Grow — $249/mo (2 vCPU · 4 GB · 50 GB)</option>
						<option value="scale">
							Scale — $599/mo (4 vCPU · 8 GB · 200 GB)
						</option>
					</select>
					<button
						type="button"
						className="settings-btn primary small"
						onClick={handleApply}
						disabled={target === currentPlan || state === "resizing"}
					>
						{state === "resizing" ? "Resizing…" : "Apply"}
					</button>
				</div>
			)}
			{error && (
				<div className="settings-hint" style={{ color: "var(--red)" }}>
					{error}
				</div>
			)}
		</section>
	);
}
