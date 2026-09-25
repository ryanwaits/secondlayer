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
import {
	type TenantRow,
	listRunningTenants,
	setTenantImageSha,
} from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";
import {
	type ProvisionerConfig,
	type RunCompose,
	projectName,
	spawnCompose,
	tenantDir,
} from "./provisioner.ts";

const IMAGE_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface TargetShaCache {
	lastGood: string | null;
}

/** Fresh, empty cache — one per process, held by whatever loop calls
 *  `resolveTargetSha` on a timer (`index.ts`). */
export function createTargetShaCache(): TargetShaCache {
	return { lastGood: null };
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
	} | null;
	const sha = body?.image_sha;
	if (typeof sha !== "string" || !IMAGE_SHA_PATTERN.test(sha)) {
		logger.warn("workload.upgrade.health_check_bad_sha", { sha });
		return cache.lastGood;
	}
	cache.lastGood = sha;
	return sha;
}

const UPGRADE_SERVICES = ["migrate", "api", "webhook-service"];

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
 * `listRunningTenants`'s order. A tenant already on `targetSha` is skipped
 * with no compose call at all.
 *
 * Per tenant: `docker pull` the target image for that tenant's compose
 * project first. A failed pull stops the round immediately — nothing has
 * changed yet, so there's nothing to roll back. A failed `up -d --wait`
 * (image pulled but the new containers never got healthy) re-ups the
 * tenant's previous sha to restore service, leaves `image_sha` unchanged,
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
	const stale = tenants.filter((t: TenantRow) => t.image_sha !== targetSha);
	if (stale.length === 0) return;

	for (const tenant of stale) {
		const acct8 = tenant.acct8;

		const pullResult = await runCompose(
			composeArgs(cfg, acct8, ["pull", ...UPGRADE_SERVICES]),
			{ WORKLOAD_IMAGE_TAG: targetSha },
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
			{ WORKLOAD_IMAGE_TAG: targetSha },
		);
		if (upResult.code !== 0) {
			logger.error("workload.upgrade.up_failed", {
				accountId: tenant.account_id,
				targetSha,
				stderr: upResult.stderr.slice(0, 2000),
			});
			const previousSha = tenant.image_sha;
			if (previousSha) {
				await runCompose(composeArgs(cfg, acct8, ["up", "-d", "--wait"]), {
					WORKLOAD_IMAGE_TAG: previousSha,
				});
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

		await setTenantImageSha(cfg.db, tenant.account_id, targetSha);
		logger.info("workload.upgrade.tenant_upgraded", {
			accountId: tenant.account_id,
			from: tenant.image_sha,
			to: targetSha,
		});
	}
}

/**
 * Wraps `upgradeTenants` with an overlap guard: a round that's still running
 * (e.g. a slow `--wait` on a large tenant) makes the NEXT tick's call a
 * no-op instead of a second round stacking on top of it. One runner per
 * process — `index.ts` creates it once and calls it every tick.
 */
export function createUpgradeRunner(
	cfg: ProvisionerConfig,
): (targetSha: string) => Promise<void> {
	let running = false;
	return async (targetSha: string): Promise<void> => {
		if (running) {
			logger.warn("workload.upgrade.round_skipped_overlap", { targetSha });
			return;
		}
		running = true;
		try {
			await upgradeTenants(cfg, targetSha);
		} finally {
			running = false;
		}
	};
}
