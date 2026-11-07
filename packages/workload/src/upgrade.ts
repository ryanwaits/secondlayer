/**
 * Rolling tenant upgrades (plan 064): a prod deploy never touches a tenant
 * stack by itself — this is what actually pulls a tenant forward to the sha
 * app-server just deployed, a few minutes after `/health` reports it.
 *
 * Two pieces:
 *   - `resolveTargetSha` reads app-server's `/health` `image_sha` and caches
 *     the last good value — an outage or a bad response keeps serving the
 *     last known target rather than ever falling back to `latest`.
 *   - `upgradeTenants` walks every `running` tenant whose recorded
 *     `image_sha` doesn't match the target and rolls it forward one at a
 *     time, stopping the round on the first failure (a bad image fails every
 *     tenant the same way, so there's nothing to gain from trying the rest).
 */

import { join } from "node:path";
import { logger } from "@secondlayer/shared";
import { type TenantRow, listRunningTenants } from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";
import {
	type ProvisionerConfig,
	type RunCompose,
	composeEnv,
	ensureTenantEnv,
	isTestnetStackAccount,
	projectName,
	recordTenantRelease,
	spawnCompose,
	templateSha,
	tenantDir,
	tenantServices,
} from "./provisioner.ts";

const IMAGE_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface TargetShaCache {
	lastGood: string | null;
	/** `deploy_sequence` that came with `lastGood`; `null` when the api did not
	 *  report one. */
	sequence?: number | null;
}

/** Fresh, empty cache — one per process, held by whatever loop calls
 *  `resolveTargetSha` on a timer (`index.ts`). */
export function createTargetShaCache(): TargetShaCache {
	return { lastGood: null, sequence: null };
}

/**
 * The deployed target sha, from app-server's `GET /health`
 * (`{"image_sha":"<40-char sha>"}`). Never throws: an unreachable app-server,
 * a non-200, a missing field, or a value that isn't a 40-char lowercase hex
 * sha all fall back to `cache.lastGood` (whatever the last good resolution
 * was) rather than `null` — the ONE case that returns `null` is no
 * resolution ever having succeeded. Never returns a value that didn't pass
 * validation: the target the caller upgrades tenants to is always something
 * app-server actually reported.
 */
export async function resolveTargetSha(
	appServerUrl: string,
	fetchImpl: FetchLike,
	cache: TargetShaCache,
): Promise<string | null> {
	let res: Response;
	try {
		res = await fetchImpl(`${appServerUrl.replace(/\/+$/, "")}/health`);
	} catch (err) {
		logger.warn("workload.upgrade.health_check_failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return cache.lastGood;
	}
	if (!res.ok) {
		logger.warn("workload.upgrade.health_check_failed", {
			status: res.status,
		});
		return cache.lastGood;
	}
	const body = (await res.json().catch(() => null)) as {
		image_sha?: unknown;
		deploy_sequence?: unknown;
	} | null;
	const sha = body?.image_sha;
	if (typeof sha !== "string" || !IMAGE_SHA_PATTERN.test(sha)) {
		logger.warn("workload.upgrade.health_check_bad_sha", { sha });
		return cache.lastGood;
	}
	const sequence =
		typeof body?.deploy_sequence === "number" &&
		Number.isSafeInteger(body.deploy_sequence) &&
		body.deploy_sequence >= 0
			? body.deploy_sequence
			: null;
	// Forward only: once a sequence is known, an answer with a lower one (or
	// none) came from a replica still on an older deploy, mid-roll. A rollback
	// is a new deploy with a NEWER sequence, so it is followed.
	if (
		cache.sequence != null &&
		(sequence === null || sequence < cache.sequence)
	) {
		logger.warn("workload.upgrade.health_older_deploy_ignored", {
			sequence,
			knownSequence: cache.sequence,
		});
		return cache.lastGood;
	}
	cache.lastGood = sha;
	cache.sequence = sequence;
	return sha;
}

function composeArgs(
	cfg: ProvisionerConfig,
	acct8: string,
	sub: string[],
): string[] {
	return [
		"-p",
		projectName(acct8),
		"-f",
		cfg.composeFile,
		"--env-file",
		join(tenantDir(cfg, acct8), ".env"),
		...sub,
	];
}

/**
 * Rolls every stale `running` tenant onto `targetSha`, one at a time, in
 * `listRunningTenants`'s order. A tenant already on `targetSha` AND the current
 * compose template (`templateSha`) is skipped with no compose call at all.
 *
 * Per tenant: `docker pull` the target image for that tenant's compose
 * project first. A failed pull stops the round immediately — nothing has
 * changed yet, so there's nothing to roll back. A failed `up -d --wait`
 * (image pulled but the new containers never got healthy) re-ups the
 * tenant's previous sha to restore service, leaves `image_sha` and
 * `template_sha` unchanged,
 * logs `workload.upgrade.rolled_back`, and stops the round the same way (a
 * bad image fails every tenant identically — trying the next one just fails
 * it too).
 */
export async function upgradeTenants(
	cfg: ProvisionerConfig,
	targetSha: string,
): Promise<void> {
	const runCompose: RunCompose = cfg.runCompose ?? spawnCompose;
	const tenants = await listRunningTenants(cfg.db);
	// Hashed once per round: every tenant runs the same template. A template
	// change (a new command flag, a new mount) rolls tenants on a current image.
	const template = templateSha(cfg);
	// The free shared testnet stack goes last: the round stops at the first
	// failure, and a failing free stack must not block paying tenants.
	const targetSequence = cfg.getTargetSequence?.() ?? null;
	const stale = tenants
		.filter(
			(t: TenantRow) =>
				t.image_sha !== targetSha ||
				(template !== null && t.template_sha !== template),
		)
		.filter((t) => {
			// Forward only: a tenant whose database has seen a newer deploy's
			// migrations must never be put on an older image.
			if (
				targetSequence !== null &&
				t.image_sequence !== null &&
				Number(t.image_sequence) > targetSequence
			) {
				logger.warn("workload.upgrade.skipped_tenant_ahead_of_target", {
					accountId: t.account_id,
					tenantSequence: Number(t.image_sequence),
					targetSequence,
				});
				return false;
			}
			return true;
		})
		.sort(
			(a, b) =>
				Number(isTestnetStackAccount(cfg, a.account_id)) -
				Number(isTestnetStackAccount(cfg, b.account_id)),
		);
	if (stale.length === 0) return;

	for (const tenant of stale) {
		const acct8 = tenant.acct8;

		// Older tenants predate the subgraph key and network vars; the template
		// needs them. Non-fatal by contract (never throws).
		await ensureTenantEnv(cfg, tenant.account_id);

		const pullResult = await runCompose(
			composeArgs(cfg, acct8, [
				"pull",
				...tenantServices(tenant.has_subgraphs),
			]),
			composeEnv(targetSha, tenant.has_subgraphs),
		);
		if (pullResult.code !== 0) {
			logger.error("workload.upgrade.pull_failed", {
				accountId: tenant.account_id,
				targetSha,
				stderr: pullResult.stderr.slice(0, 2000),
			});
			return;
		}

		const upResult = await runCompose(
			composeArgs(cfg, acct8, ["up", "-d", "--wait"]),
			composeEnv(targetSha, tenant.has_subgraphs),
		);
		if (upResult.code !== 0) {
			logger.error("workload.upgrade.up_failed", {
				accountId: tenant.account_id,
				targetSha,
				stderr: upResult.stderr.slice(0, 2000),
			});
			const previousSha = tenant.image_sha;
			if (previousSha) {
				await runCompose(
					composeArgs(cfg, acct8, ["up", "-d", "--wait"]),
					composeEnv(previousSha, tenant.has_subgraphs),
				);
			} else {
				// No prior sha recorded for this tenant (its first upgrade round
				// since `image_sha` started being tracked) — nothing to roll back
				// TO, so leave it on whatever `up -d --wait` left running.
				logger.warn("workload.upgrade.rollback_skipped_no_previous_sha", {
					accountId: tenant.account_id,
				});
			}
			logger.error("workload.upgrade.rolled_back", {
				accountId: tenant.account_id,
				from: targetSha,
				to: previousSha,
				stderr: upResult.stderr.slice(0, 2000),
			});
			return;
		}

		await recordTenantRelease(cfg, tenant.account_id, targetSha, template);
		logger.info("workload.upgrade.tenant_upgraded", {
			accountId: tenant.account_id,
			from: tenant.image_sha,
			to: targetSha,
		});
	}
}

export interface UpgradeRunner {
	/** One round; a no-op while another is in flight or after `drain`. */
	run(targetSha: string): Promise<void>;
	/** True while a round is in flight. */
	isBusy(): boolean;
	/** Stops any new round from starting, then resolves `true` once the
	 *  in-flight round (if any) finishes, or `false` after `timeoutMs`. */
	drain(timeoutMs: number): Promise<boolean>;
}

/**
 * Wraps `upgradeTenants` with an overlap guard: a round that's still running
 * (e.g. a slow `--wait` on a large tenant) makes the NEXT tick's call a
 * no-op instead of a second round stacking on top of it. `drain` lets
 * shutdown wait out the round instead of killing `docker compose` mid-recreate.
 * One runner per process — `index.ts` creates it once and calls it every tick.
 */
export function createUpgradeRunner(cfg: ProvisionerConfig): UpgradeRunner {
	let inFlight: Promise<void> | null = null;
	let draining = false;
	return {
		async run(targetSha) {
			if (draining) {
				logger.warn("workload.upgrade.round_skipped_draining", { targetSha });
				return;
			}
			if (inFlight) {
				logger.warn("workload.upgrade.round_skipped_overlap", { targetSha });
				return;
			}
			const round = upgradeTenants(cfg, targetSha);
			inFlight = round;
			try {
				await round;
			} finally {
				inFlight = null;
			}
		},
		isBusy: () => inFlight !== null,
		async drain(timeoutMs) {
			draining = true;
			const round = inFlight;
			if (!round) return true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			});
			const finished = round.then(
				() => true as const,
				() => true as const, // a failed round is still a finished round
			);
			try {
				return await Promise.race([finished, timedOut]);
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
