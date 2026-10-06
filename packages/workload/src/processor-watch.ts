/**
 * Watches each running tenant's `subgraph-processor` for the two ways
 * customer handler code can wedge it. The runner only counts THROWN errors
 * (`DEFAULT_ERROR_THRESHOLD`), so neither shows up there:
 *
 *   - OOM: the container hit its memory limit and was killed.
 *   - Stall: a synchronous `while (true) {}` blocks the processor's event
 *     loop, so a subgraph's cursor stops moving while the hosted tip keeps
 *     advancing.
 *
 * An unhealthy processor is restarted. After `MAX_RESTARTS_PER_HEIGHT`
 * restarts at the same cursor height the subgraph is marked `error` through
 * the tenant's own api (instance token, loopback): customer code doesn't get
 * to report its own health, and the processor skips non-`active` subgraphs, so
 * that ends the loop. A restart is logged with tenant + subgraph name, never
 * handler output.
 *
 * State lives in memory. A host restart loses it, which only delays the next
 * decision by one stall window.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@secondlayer/shared";
import { listRunningTenants } from "./control-db.ts";
import type { TenantRow } from "./control-db.ts";
import { type RunDocker, spawnDocker } from "./meters.ts";
import {
	type ProvisionerConfig,
	type RunCompose,
	parseEnvFile,
	projectName,
	spawnCompose,
	tenantDir,
} from "./provisioner.ts";

/** A cursor that hasn't moved for this long while the hosted tip has is stalled. */
export const STALL_MS = 10 * 60_000;
export const MAX_RESTARTS_PER_HEIGHT = 3;

export interface SubgraphCursor {
	name: string;
	status: string;
	lastProcessedBlock: number;
}

export interface ProcessorWatchDeps {
	/** `State.OOMKilled` + `State.FinishedAt` of the processor container, or
	 *  `null` when it doesn't exist. */
	inspectProcessor: (
		acct8: string,
	) => Promise<{ oomKilled: boolean; finishedAt: string } | null>;
	listSubgraphs: (tenant: TenantEndpoint) => Promise<SubgraphCursor[]>;
	haltSubgraph: (
		tenant: TenantEndpoint,
		name: string,
		reason: string,
	) => Promise<void>;
	/** Hosted chain tip; `null` when unknown (stall detection then waits). */
	hostedTip: () => Promise<number | null>;
	restartProcessor: (tenant: TenantRow) => Promise<boolean>;
	now: () => number;
}

export interface TenantEndpoint {
	baseUrl: string;
	instanceToken: string;
}

interface Tracker {
	height: number;
	/** When `height` was first seen. */
	movedAt: number;
	/** Hosted tip at that moment. */
	tipAtMove: number | null;
	/** Restarts performed while the cursor sat at `height`. */
	restarts: number;
	/** `height` as of the previous tick, to tell who stood still across it. */
	unchangedSinceLastTick: boolean;
}

/** The container name compose gives the processor (project `tenant-<acct8>`). */
function processorContainer(acct8: string): string {
	return `tenant-${acct8}-subgraph-processor-1`;
}

function tenantEndpoint(
	cfg: ProvisionerConfig,
	tenant: TenantRow,
): TenantEndpoint | null {
	try {
		const env = parseEnvFile(
			readFileSync(join(tenantDir(cfg, tenant.acct8), ".env"), "utf8"),
		);
		if (!env.INSTANCE_TOKEN) return null;
		return {
			baseUrl: `http://127.0.0.1:${tenant.api_port}`,
			instanceToken: env.INSTANCE_TOKEN,
		};
	} catch {
		return null;
	}
}

/** Real dependencies: `docker inspect`, the tenant api over loopback, the
 *  hosted tip over HTTP, and `docker compose restart`. */
export function realProcessorWatchDeps(
	cfg: ProvisionerConfig,
	opts: {
		runDocker?: RunDocker;
		runCompose?: RunCompose;
		fetchImpl?: typeof fetch;
	} = {},
): ProcessorWatchDeps {
	const runDocker = opts.runDocker ?? spawnDocker;
	const runCompose = opts.runCompose ?? cfg.runCompose ?? spawnCompose;
	const doFetch = opts.fetchImpl ?? fetch;
	const authed = (t: TenantEndpoint) => ({
		authorization: `Bearer ${t.instanceToken}`,
	});

	return {
		inspectProcessor: async (acct8) => {
			const res = await runDocker([
				"inspect",
				"--format",
				"{{.State.OOMKilled}} {{.State.FinishedAt}}",
				processorContainer(acct8),
			]);
			if (res.code !== 0) return null;
			const [oom, finishedAt] = res.stdout.trim().split(" ");
			return { oomKilled: oom === "true", finishedAt: finishedAt ?? "" };
		},
		listSubgraphs: async (tenant) => {
			const res = await doFetch(`${tenant.baseUrl}/api/subgraphs`, {
				headers: authed(tenant),
			});
			if (!res.ok) throw new Error(`list subgraphs failed: ${res.status}`);
			const body = (await res.json()) as { data?: SubgraphCursor[] };
			return body.data ?? [];
		},
		haltSubgraph: async (tenant, name, reason) => {
			const res = await doFetch(
				`${tenant.baseUrl}/api/subgraphs/${encodeURIComponent(name)}/halt`,
				{
					method: "POST",
					headers: { ...authed(tenant), "content-type": "application/json" },
					body: JSON.stringify({ reason }),
				},
			);
			if (!res.ok) throw new Error(`halt subgraph failed: ${res.status}`);
		},
		hostedTip: async () => {
			try {
				const res = await doFetch(
					`${cfg.hostedApiUrl.replace(/\/+$/, "")}/v1/streams/tip`,
					{ headers: { authorization: "Bearer sk-sl_streams_status_public" } },
				);
				if (!res.ok) return null;
				const body = (await res.json()) as { block_height?: number };
				return typeof body.block_height === "number" ? body.block_height : null;
			} catch {
				return null;
			}
		},
		restartProcessor: async (tenant) => {
			// Compose interpolates the whole file, so it needs SOME image tag; the
			// one this tenant already runs changes nothing (`restart` never
			// recreates a container).
			const tag = tenant.image_sha ?? cfg.getTargetSha();
			if (!tag) return false;
			const res = await runCompose(
				[
					"-p",
					projectName(tenant.acct8),
					"-f",
					cfg.composeFile,
					"--env-file",
					join(tenantDir(cfg, tenant.acct8), ".env"),
					"restart",
					"subgraph-processor",
				],
				{ WORKLOAD_IMAGE_TAG: tag },
			);
			return res.code === 0;
		},
		now: () => Date.now(),
	};
}

/**
 * One check over every running tenant. Returns the per-tick function the
 * 5-minute loop calls. Never throws: one tenant's failure is logged and the
 * rest are still checked.
 */
export function createProcessorWatch(
	cfg: ProvisionerConfig,
	deps: ProcessorWatchDeps = realProcessorWatchDeps(cfg),
): () => Promise<void> {
	const trackers = new Map<string, Tracker>();
	/** `FinishedAt` of the last OOM kill already acted on, per account, so a
	 *  sticky `OOMKilled` flag can't restart the same death every tick. */
	const handledOom = new Map<string, string>();

	async function checkTenant(
		tenant: TenantRow,
		tip: number | null,
	): Promise<void> {
		const endpoint = tenantEndpoint(cfg, tenant);
		if (!endpoint) return;
		const now = deps.now();

		const subgraphs = (await deps.listSubgraphs(endpoint)).filter(
			(s) => s.status === "active",
		);
		const seen = new Set<string>();
		for (const sub of subgraphs) {
			const key = `${tenant.account_id}:${sub.name}`;
			seen.add(key);
			const tracker = trackers.get(key);
			if (!tracker || tracker.height !== sub.lastProcessedBlock) {
				trackers.set(key, {
					height: sub.lastProcessedBlock,
					movedAt: now,
					tipAtMove: tip,
					restarts: 0,
					unchangedSinceLastTick: false,
				});
			} else {
				tracker.unchangedSinceLastTick = true;
			}
		}
		for (const key of trackers.keys()) {
			if (key.startsWith(`${tenant.account_id}:`) && !seen.has(key)) {
				trackers.delete(key);
			}
		}

		const container = await deps.inspectProcessor(tenant.acct8);
		const newOom =
			container?.oomKilled === true &&
			handledOom.get(tenant.account_id) !== container.finishedAt;

		const stalled = subgraphs.filter((sub) => {
			const t = trackers.get(`${tenant.account_id}:${sub.name}`);
			return (
				t !== undefined &&
				tip !== null &&
				t.tipAtMove !== null &&
				tip > t.tipAtMove &&
				now - t.movedAt >= STALL_MS
			);
		});
		if (!newOom && stalled.length === 0) return;

		// A stall names its subgraphs. An OOM doesn't, so blame whoever stood
		// still across the last tick.
		const culprits = stalled.length
			? stalled
			: subgraphs.filter(
					(sub) =>
						trackers.get(`${tenant.account_id}:${sub.name}`)
							?.unchangedSinceLastTick,
				);
		const reason = newOom ? "out_of_memory" : "stalled";

		const restarted = await deps.restartProcessor(tenant);
		if (newOom && container)
			handledOom.set(tenant.account_id, container.finishedAt);
		logger.warn("workload.processor.restarted", {
			accountId: tenant.account_id,
			reason,
			ok: restarted,
			subgraphs: culprits.map((s) => s.name),
		});

		for (const sub of culprits) {
			const tracker = trackers.get(`${tenant.account_id}:${sub.name}`);
			if (!tracker) continue;
			tracker.restarts++;
			if (tracker.restarts < MAX_RESTARTS_PER_HEIGHT) continue;
			await deps.haltSubgraph(
				endpoint,
				sub.name,
				`Halted after ${tracker.restarts} restarts at block ${tracker.height} (${reason}). Redeploy to resume.`,
			);
			trackers.delete(`${tenant.account_id}:${sub.name}`);
			logger.error("workload.processor.subgraph_halted", {
				accountId: tenant.account_id,
				subgraph: sub.name,
				height: tracker.height,
				reason,
			});
		}
	}

	return async () => {
		const tenants = await listRunningTenants(cfg.db);
		if (tenants.length === 0) return;
		const tip = await deps.hostedTip();
		for (const tenant of tenants) {
			try {
				await checkTenant(tenant, tip);
			} catch (err) {
				logger.warn("workload.processor.check_failed", {
					accountId: tenant.account_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	};
}
