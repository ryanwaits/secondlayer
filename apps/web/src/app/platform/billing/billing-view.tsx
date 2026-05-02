"use client";

import { CollapsibleSection } from "@/components/console/collapsible-section";
import type { BillingCaps } from "@/lib/billing";
import { type UsageResponse, formatCents } from "@/lib/usage";
import type { Plan, PlanId } from "@secondlayer/shared/pricing";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CapForm } from "./cap-form";
import { DangerZone } from "./danger-zone";
import { DbAccessSection } from "./db-access";
import { KeyRevealModal } from "./key-reveal-modal";
import { PortalLink } from "./portal-link";
import { ProvisionProgress } from "./provision-progress";
import { type ProvisionResponse, ProvisionStart } from "./provision-start";
import { ResizeTierButton } from "./resize-tier-button";
import { UpgradeButton } from "./upgrade-button";

interface Account {
	id: string;
	email: string;
	plan: string;
}

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

export function BillingView({
	initialTenant,
	initialRuntime,
	account,
	caps,
	usage,
	sessionToken,
	plans,
	planIds,
}: {
	initialTenant: TenantSummary | null;
	initialRuntime: TenantRuntime | null;
	account: Account;
	caps: BillingCaps | null;
	usage: UsageResponse | null;
	sessionToken: string;
	plans: Record<PlanId, Plan>;
	planIds: readonly PlanId[];
}) {
	const [tenant, setTenant] = useState<TenantSummary | null>(initialTenant);
	const [runtime, setRuntime] = useState<TenantRuntime | null>(initialRuntime);
	const [provisioningView, setProvisioningView] = useState(false);
	const [reveal, setReveal] = useState<RevealedKeys | null>(null);

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
			<>
				<h1 className="settings-title">Billing</h1>
				<p className="settings-desc">
					Spin up a dedicated instance to start. Plan, capacity, and billing all
					live here.
				</p>
				<ProvisionStart
					sessionToken={sessionToken}
					plans={plans}
					onProvisioning={() => setProvisioningView(true)}
					onProvisioned={(resp: ProvisionResponse) => {
						setProvisioningView(false);
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

	return (
		<>
			<ActiveView
				tenant={tenant}
				runtime={runtime}
				account={account}
				caps={caps}
				usage={usage}
				sessionToken={sessionToken}
				plans={plans}
				planIds={planIds}
				onTenantChanged={(updated) => {
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

// ─── ActiveView (tenant exists) ────────────────────────────────────

function ActiveView({
	tenant,
	runtime,
	account,
	caps,
	usage,
	sessionToken,
	plans,
	planIds,
	onTenantChanged,
	onKeyRotated,
	onDeleted,
}: {
	tenant: TenantSummary;
	runtime: TenantRuntime | null;
	account: Account;
	caps: BillingCaps | null;
	usage: UsageResponse | null;
	sessionToken: string;
	plans: Record<PlanId, Plan>;
	planIds: readonly PlanId[];
	onTenantChanged: (updated: TenantSummary) => void;
	onKeyRotated: (
		type: RotateType,
		rotated: { serviceKey?: string; anonKey?: string },
	) => void;
	onDeleted: () => void;
}) {
	const isSuspended = tenant.status === "suspended";
	const isHobby = account.plan === "hobby";

	const currentCents = usage?.spend.currentCents ?? 0;
	const frozenAt = caps?.frozenAt ?? null;
	const capCents = caps?.monthlyCapCents ?? null;
	const thresholdPct = caps?.alertThresholdPct ?? 80;
	const thresholdHit = usage?.spend.thresholdHit ?? false;

	const desc = isSuspended
		? isHobby
			? "Paused after 7 days idle. Data preserved. The next CLI command auto-resumes, or click Resume below."
			: "Containers stopped — data preserved. Resume below to bring everything back online in ~20s."
		: isHobby
			? "You're on the Free plan. Upgrade to unlock production capacity and spend controls."
			: "Manage your instance, plan, and spend controls. Payment, invoices, and cancellation live in the Stripe portal.";

	return (
		<>
			<h1 className="settings-title">Billing</h1>
			<p className="settings-desc">{desc}</p>

			{!isHobby && frozenAt ? (
				<div className="callout error" role="alert">
					<svg
						className="callout-icon"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<title>Frozen</title>
						<rect x="3" y="7" width="10" height="7" rx="1" />
						<path d="M6 7V5a2 2 0 0 1 4 0v2" />
					</svg>
					<div className="callout-body">
						<div className="callout-title">Services frozen — spend cap hit</div>
						<div className="callout-sub">
							Raise the cap below or wait for the next billing cycle (cap resets
							with invoice.paid).
						</div>
					</div>
				</div>
			) : !isHobby && thresholdHit && capCents != null ? (
				<div className="callout warn" role="alert">
					<svg
						className="callout-icon"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<title>Threshold</title>
						<path d="M8 2l6 11H2L8 2z" />
						<path d="M8 6v4" />
						<circle cx="8" cy="12" r="0.5" fill="currentColor" />
					</svg>
					<div className="callout-body">
						<div className="callout-title">
							Projected spend at {Math.round(thresholdPct)}% of cap
						</div>
						<div className="callout-sub">
							{formatCents(usage?.spend.projectedCents ?? 0)} projected of{" "}
							{formatCents(capCents)}. Raise the cap below or upgrade your plan.
						</div>
					</div>
				</div>
			) : null}

			<OverviewSection
				tenant={tenant}
				runtime={runtime}
				sessionToken={sessionToken}
				onTenantChanged={onTenantChanged}
			/>

			<PlanSection
				tenant={tenant}
				sessionToken={sessionToken}
				plans={plans}
				planIds={planIds}
				onResized={onTenantChanged}
			/>

			{!isHobby && (
				<SpendControlsSection
					capCents={capCents}
					currentCents={currentCents}
					thresholdHit={thresholdHit}
					thresholdPct={thresholdPct}
					frozen={!!frozenAt}
				/>
			)}

			{!isHobby && <PaymentSection />}

			<CollapsibleSection title="Connection" defaultOpen={false}>
				<ConnectSection tenant={tenant} />
			</CollapsibleSection>

			<CollapsibleSection title="Keys" defaultOpen={false}>
				<KeysSection sessionToken={sessionToken} onKeyRotated={onKeyRotated} />
			</CollapsibleSection>

			{!isSuspended && (
				<CollapsibleSection title="Database access" defaultOpen={false}>
					<DbAccessSection sessionToken={sessionToken} />
				</CollapsibleSection>
			)}

			<CollapsibleSection title="Danger zone" defaultOpen={false}>
				<DangerZone
					slug={tenant.slug}
					status={tenant.status}
					sessionToken={sessionToken}
					onSuspended={() => {
						/* tenant poll picks up the new status */
					}}
					onDeleted={onDeleted}
					onRotateAll={() => rotateKeys("both", sessionToken, onKeyRotated)}
				/>
			</CollapsibleSection>

			{!isHobby && (
				<div
					style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 24 }}
				>
					Billed as: <code>{account.email}</code>
				</div>
			)}
		</>
	);
}

// ─── Overview ──────────────────────────────────────────────────────

function OverviewSection({
	tenant,
	runtime,
	sessionToken,
	onTenantChanged,
}: {
	tenant: TenantSummary;
	runtime: TenantRuntime | null;
	sessionToken: string;
	onTenantChanged: (updated: TenantSummary) => void;
}) {
	const [resuming, setResuming] = useState(false);
	const [resumeError, setResumeError] = useState<string | null>(null);
	const isSuspended = tenant.status === "suspended";

	const handleResume = async () => {
		if (resuming) return;
		setResuming(true);
		setResumeError(null);
		try {
			const res = await fetch("/api/tenants/me/resume", {
				method: "POST",
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `Resume failed (${res.status})`);
			}
			const data = (await res.json()) as { tenant: TenantSummary };
			onTenantChanged(data.tenant);
		} catch (e) {
			setResumeError(e instanceof Error ? e.message : "Resume failed");
		} finally {
			setResuming(false);
		}
	};

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
					<div
						className="val"
						style={{ display: "flex", alignItems: "center", gap: 8 }}
					>
						<StatusPill status={tenant.status} />
						{isSuspended && (
							<button
								type="button"
								className="settings-btn primary small"
								onClick={handleResume}
								disabled={resuming}
							>
								{resuming ? "Resuming…" : "Resume"}
							</button>
						)}
					</div>
				</div>
				<div className="row">
					<div className="key">resources</div>
					<div className="val">{resourceSummary(tenant, runtime)}</div>
				</div>
				<div className="row">
					<div className="key">created</div>
					<div className="val" suppressHydrationWarning>
						{new Date(tenant.createdAt).toLocaleString()}
					</div>
				</div>
			</div>
			{resumeError && (
				<div className="settings-hint" style={{ color: "var(--red)" }}>
					{resumeError}
				</div>
			)}
		</section>
	);
}

function resourceSummary(
	tenant: TenantSummary,
	runtime: TenantRuntime | null,
): string {
	if (!runtime || runtime.containers.length === 0) {
		return "Awaiting first metrics…";
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

	const storageStr =
		runtime.storageUsedMb != null
			? `${formatMb(runtime.storageUsedMb)}/${formatMb(tenant.storageLimitMb)}`
			: "—";

	const memStr =
		totalMemLimit > 0
			? `${formatBytes(totalMem)}/${formatBytes(totalMemLimit)}`
			: "—";

	const healthy = runtime.containers.filter(
		(c) => c.state === "running",
	).length;

	return `CPU ${cpuPct.toFixed(0)}% · Mem ${memStr} · Storage ${storageStr} · ${healthy}/${runtime.containers.length} healthy`;
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

// ─── Plan ──────────────────────────────────────────────────────────

function PlanSection({
	tenant,
	sessionToken,
	plans,
	planIds,
	onResized,
}: {
	tenant: TenantSummary;
	sessionToken: string;
	plans: Record<PlanId, Plan>;
	planIds: readonly PlanId[];
	onResized: (updated: TenantSummary) => void;
}) {
	return (
		<section className="settings-section">
			<div className="settings-section-title">Plan</div>
			<div className="tier-grid">
				{planIds.map((id) => {
					const plan = plans[id];
					const isCurrent = tenant.plan === id;
					return (
						<div key={id} className={`tier-card${isCurrent ? " current" : ""}`}>
							<div className="tier-label">
								<span>{plan.displayName}</span>
								{isCurrent && <span className="current-badge">Current</span>}
							</div>
							<div className="tier-price">
								{plan.monthlyPriceCents == null ? (
									<span style={{ fontSize: 18 }}>Custom</span>
								) : plan.monthlyPriceCents === 0 ? (
									<>
										Free
										<span className="unit" />
									</>
								) : (
									<>
										${plan.monthlyPriceCents / 100}
										<span className="unit">/mo</span>
									</>
								)}
							</div>
							<div className="tier-tag">{plan.tagline}</div>
							{plan.annualPriceCents ? (
								<div className="settings-hint" style={{ marginTop: -4 }}>
									${plan.annualPriceCents / 100}/yr · 2 months free
								</div>
							) : null}
							<ul>
								{plan.features.map((f) => (
									<li key={f}>{f}</li>
								))}
							</ul>
							<TierAction
								plan={plan}
								tenantPlan={tenant.plan}
								sessionToken={sessionToken}
								onResized={onResized}
							/>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function TierAction({
	plan,
	tenantPlan,
	sessionToken,
	onResized,
}: {
	plan: Plan;
	tenantPlan: string;
	sessionToken: string;
	onResized: (updated: TenantSummary) => void;
}) {
	const isCurrent = plan.id === tenantPlan;
	const isHobbyTenant = tenantPlan === "hobby";

	if (isCurrent) return null;

	if (plan.id === "enterprise") {
		return (
			<a
				href="mailto:hey@secondlayer.tools"
				className="settings-btn ghost"
				style={{ textAlign: "center" }}
			>
				Contact us
			</a>
		);
	}

	if (plan.id === "hobby") {
		// Paid → Hobby: route through Stripe portal (cancellation lives there)
		return (
			<a
				href="#payment"
				className="settings-btn ghost"
				style={{ textAlign: "center" }}
			>
				Downgrade in portal
			</a>
		);
	}

	// Paid tier card — Launch or Scale
	if (isHobbyTenant) {
		return (
			<div style={{ display: "grid", gap: 8 }}>
				<UpgradeButton
					tier={plan.id as "launch" | "scale"}
					label={`Upgrade to ${plan.displayName}`}
					variant={plan.id === "launch" ? "primary" : "ghost"}
				/>
				{plan.annualPriceCents ? (
					<UpgradeButton
						tier={plan.id as "launch" | "scale"}
						interval="year"
						label={`Annual · $${plan.annualPriceCents / 100}/yr`}
						variant="ghost"
					/>
				) : null}
			</div>
		);
	}

	return (
		<ResizeTierButton
			targetPlan={plan.id as "launch" | "scale"}
			currentPlan={tenantPlan}
			label={`Resize to ${plan.displayName}`}
			variant={plan.id === "launch" ? "ghost" : "primary"}
			sessionToken={sessionToken}
			onResized={onResized}
		/>
	);
}

// ─── Spend Controls ────────────────────────────────────────────────

function SpendControlsSection({
	capCents,
	currentCents,
	thresholdHit,
	thresholdPct,
	frozen,
}: {
	capCents: number | null;
	currentCents: number;
	thresholdHit: boolean;
	thresholdPct: number;
	frozen: boolean;
}) {
	return (
		<section className="settings-section">
			<div className="settings-section-title">Spend controls</div>
			<InlineCapStrip
				capCents={capCents}
				currentCents={currentCents}
				thresholdHit={thresholdHit}
				frozen={frozen}
			/>
			<CapForm
				initialCapCents={capCents}
				initialThresholdPct={thresholdPct}
				currentSpendCents={currentCents}
			/>
		</section>
	);
}

function InlineCapStrip({
	capCents,
	currentCents,
	thresholdHit,
	frozen,
}: {
	capCents: number | null;
	currentCents: number;
	thresholdHit: boolean;
	frozen: boolean;
}) {
	if (capCents == null) {
		return (
			<div className="cap-strip none" style={{ marginBottom: 16 }}>
				<div className="cap-strip-label">
					<span>No spend cap set</span>
					<span className="pct">— {formatCents(currentCents)} this period</span>
				</div>
			</div>
		);
	}
	const usedPct = Math.min((currentCents / capCents) * 100, 100);
	const fillClass = frozen ? "red" : thresholdHit ? "yellow" : "accent";
	const stripClass = frozen ? "over" : thresholdHit ? "hot" : "";

	return (
		<div className={`cap-strip ${stripClass}`} style={{ marginBottom: 16 }}>
			<div className="cap-strip-label">
				<span>This period</span>
				<span className="pct">
					{formatCents(currentCents)} / {formatCents(capCents)} ·{" "}
					{Math.round(usedPct)}%{frozen ? " 🔒" : thresholdHit ? " ⚠" : ""}
				</span>
			</div>
			<div className="cap-strip-bar">
				<div className="usage-bar">
					<div
						className={`usage-bar-fill ${fillClass}`}
						style={{ width: `${usedPct}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

// ─── Payment ───────────────────────────────────────────────────────

function PaymentSection() {
	return (
		<section className="settings-section">
			<div className="settings-section-title">Payment</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				<PortalLink
					label="Payment methods & invoices"
					sub="Update card · download invoices · view receipts (via Stripe)"
				/>
				<PortalLink
					label="Cancel or change subscription"
					sub="Downgrade · cancel · pause · change email"
				/>
			</div>
			<div className="soon-note">
				<Link href="/usage" style={{ color: "var(--text-main)" }}>
					View usage →
				</Link>
			</div>
		</section>
	);
}

// ─── Connect ───────────────────────────────────────────────────────

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
sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-subgraph.ts
sl subgraphs deploy subgraphs/my-subgraph.ts`,
	}[tab];

	const handleCopyUrl = async () => {
		await navigator.clipboard.writeText(tenant.apiUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<>
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
		</>
	);
}

// ─── Keys ──────────────────────────────────────────────────────────

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
		<>
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
		</>
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
