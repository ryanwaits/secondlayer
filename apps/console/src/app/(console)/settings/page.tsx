import { CopyButton } from "@/components/console/copy-button";
import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import { humanBytes, humanUptime } from "@/lib/format";
import type {
	HealthInfo,
	InstanceFeatures,
	InstanceMetrics,
	InstanceSummary,
} from "@/lib/types";

/**
 * Read-only settings v1 — instance identity, the feature manifest, and the
 * token-rotation note. Configuration lives in the operator's compose env,
 * not in the console; this screen tells you what's running, not knobs.
 */

function shortSha(sha: string): string {
	return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** One flat chip per flag; nested groups (protocolDatasets) dot-join. */
function flattenFeatures(
	features: InstanceFeatures["features"],
): { name: string; on: boolean }[] {
	const out: { name: string; on: boolean }[] = [];
	for (const [key, value] of Object.entries(features)) {
		if (typeof value === "boolean") {
			out.push({ name: key, on: value });
		} else if (value && typeof value === "object") {
			for (const [sub, on] of Object.entries(value)) {
				if (typeof on === "boolean") out.push({ name: `${key}.${sub}`, on });
			}
		}
	}
	return out;
}

export default async function SettingsPage() {
	const [instanceResult, healthResult, metricsResult, featuresResult] =
		await Promise.allSettled([
			apiRequest<InstanceSummary>("/v1/instance"),
			apiRequest<HealthInfo>("/health"),
			apiRequest<InstanceMetrics>("/v1/instance/metrics"),
			apiRequest<InstanceFeatures>("/v1/instance/features"),
		]);
	const instance =
		instanceResult.status === "fulfilled" ? instanceResult.value : null;
	const health =
		healthResult.status === "fulfilled" ? healthResult.value : null;
	const metrics =
		metricsResult.status === "fulfilled" ? metricsResult.value : null;
	const features =
		featuresResult.status === "fulfilled"
			? flattenFeatures(featuresResult.value.features)
			: null;

	const unreachable = instance === null && health === null && metrics === null;

	return (
		<>
			<OverviewTopbar crumbs={[{ label: "settings" }]} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="ident">
						<h2>Settings</h2>
						<span className="kv">
							read-only · configuration lives in your compose env
						</span>
					</div>

					{unreachable ? (
						<EmptyState message="Instance unreachable — is the runtime up and SL_API_URL pointed at it?" />
					) : (
						<>
							<section className="sg-sec">
								<div className="sg-sec-head">
									<span className="t">Instance</span>
								</div>
								<div className="meta">
									{instance?.network && (
										<div className="meta-card">
											<div className="ov-label">Network</div>
											<div className="meta-v mono">{instance.network}</div>
										</div>
									)}
									{instance?.mode && (
										<div className="meta-card">
											<div className="ov-label">Mode</div>
											<div className="meta-v mono">{instance.mode}</div>
										</div>
									)}
									{instance?.instance_id && (
										<div className="meta-card">
											<div className="ov-label">Instance id</div>
											<div className="meta-v mono" title={instance.instance_id}>
												{shortId(instance.instance_id)}
												<CopyButton code={instance.instance_id} inline />
											</div>
										</div>
									)}
									{health?.image_sha && (
										<div className="meta-card">
											<div className="ov-label">Image</div>
											<div className="meta-v mono" title={health.image_sha}>
												{shortSha(health.image_sha)}
											</div>
										</div>
									)}
									{metrics != null && (
										<div className="meta-card">
											<div className="ov-label">Uptime</div>
											<div className="meta-v mono">
												{humanUptime(metrics.uptime_s)}
											</div>
										</div>
									)}
									{metrics?.db_size_bytes != null && (
										<div className="meta-card">
											<div className="ov-label">Postgres</div>
											<div className="meta-v mono">
												{humanBytes(metrics.db_size_bytes)}
											</div>
										</div>
									)}
								</div>
							</section>

							{features !== null && features.length > 0 && (
								<section className="sg-sec">
									<div className="sg-sec-head">
										<span className="t">
											Features<span className="cnt">{features.length}</span>
										</span>
									</div>
									<div className="feat-grid">
										{features.map((f) => (
											<span
												key={f.name}
												className={`feat-chip${f.on ? "" : " off"}`}
											>
												{f.name}
												<span className="state">{f.on ? "on" : "off"}</span>
											</span>
										))}
									</div>
								</section>
							)}

							<section className="sg-sec">
								<div className="sg-sec-head">
									<span className="t">Instance token</span>
								</div>
								<div className="panel">
									<h4>Rotation</h4>
									<p>
										The console authenticates to this instance with{" "}
										<span className="mono">INSTANCE_TOKEN</span>. To rotate it,
										set a new value in your compose env on both the instance and
										console containers, then restart — there is no in-band
										rotation.
									</p>
									<a
										href="https://www.secondlayer.tools/docs/self-host"
										target="_blank"
										rel="noopener noreferrer"
										className="sg-ep-link"
									>
										Self-hosting docs →
									</a>
								</div>
							</section>
						</>
					)}
				</div>
			</div>
		</>
	);
}
