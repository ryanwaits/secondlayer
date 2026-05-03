import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { recordProvisioningAudit } from "@secondlayer/shared/db/queries/provisioning-audit";
import { computeEffectiveCompute } from "@secondlayer/shared/db/queries/tenant-compute-addons";
import {
	getTenantByAccount,
	setTenantStatus,
	updateTenantPlan,
} from "@secondlayer/shared/db/queries/tenants";
import { getPlan } from "@secondlayer/shared/pricing";
import {
	ProvisionerError,
	resizeTenant as provisionerResize,
} from "./provisioner-client.ts";
import type { UpgradeableTier } from "./tier-mapping.ts";

type SyncResult =
	| { status: "resized"; from: string; to: UpgradeableTier; slug: string }
	| { status: "noop"; reason: string; slug?: string };

const PLAN_RANK: Record<string, number> = {
	launch: 1,
	scale: 2,
	enterprise: 3,
};

export async function syncTenantToPaidPlan(input: {
	accountId: string;
	targetPlan: UpgradeableTier;
	actor: string;
	reason: string;
}): Promise<SyncResult> {
	const db = getDb();
	const tenant = await getTenantByAccount(db, input.accountId);
	if (!tenant) return { status: "noop", reason: "no_tenant" };
	const needsLimitClear =
		tenant.status === "limit_warning" || tenant.status === "paused_limit";
	if (tenant.plan === input.targetPlan && !needsLimitClear) {
		return { status: "noop", reason: "already_on_plan", slug: tenant.slug };
	}
	if (tenant.plan === "enterprise") {
		return { status: "noop", reason: "enterprise_locked", slug: tenant.slug };
	}
	if (tenant.status === "deleted") {
		return { status: "noop", reason: "tenant_deleted", slug: tenant.slug };
	}

	const fromRank = PLAN_RANK[tenant.plan] ?? -1;
	const toRank = PLAN_RANK[input.targetPlan];
	if (fromRank > toRank) {
		return {
			status: "noop",
			reason: "target_below_current_plan",
			slug: tenant.slug,
		};
	}

	const baseAlloc = getPlan(input.targetPlan);
	const effective = await computeEffectiveCompute(db, tenant.id, {
		cpus: baseAlloc.totalCpus,
		memoryMb: baseAlloc.totalMemoryMb,
		storageLimitMb: baseAlloc.storageLimitMb,
	});

	logger.info("billing.tenant_plan_sync.start", {
		accountId: input.accountId,
		slug: tenant.slug,
		from: tenant.plan,
		to: input.targetPlan,
		reason: input.reason,
	});

	try {
		await provisionerResize(tenant.slug, {
			plan: input.targetPlan,
			totalCpus: effective.cpus,
			totalMemoryMb: effective.memoryMb,
			storageLimitMb: effective.storageLimitMb,
		});
		await updateTenantPlan(
			db,
			tenant.slug,
			input.targetPlan,
			effective.cpus,
			effective.memoryMb,
			effective.storageLimitMb,
		);
		await setTenantStatus(db, tenant.slug, "active");
		await recordProvisioningAudit(db, {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId: input.accountId,
			actor: input.actor,
			event: "resize",
			status: "ok",
			detail: {
				from: tenant.plan,
				to: input.targetPlan,
				reason: input.reason,
				source: "billing_plan_sync",
				clearedLimitState: needsLimitClear ? tenant.status : undefined,
			},
		});
		logger.info("billing.tenant_plan_sync.done", {
			accountId: input.accountId,
			slug: tenant.slug,
			from: tenant.plan,
			to: input.targetPlan,
		});
		return {
			status: "resized",
			from: tenant.plan,
			to: input.targetPlan,
			slug: tenant.slug,
		};
	} catch (err) {
		await recordProvisioningAudit(db, {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId: input.accountId,
			actor: input.actor,
			event: "resize",
			status: "error",
			detail: {
				from: tenant.plan,
				to: input.targetPlan,
				reason: input.reason,
				source: "billing_plan_sync",
				provisionerStatus:
					err instanceof ProvisionerError ? err.status : undefined,
			},
			error: err instanceof Error ? err.message : String(err),
		});
		logger.error("billing.tenant_plan_sync.failed", {
			accountId: input.accountId,
			slug: tenant.slug,
			from: tenant.plan,
			to: input.targetPlan,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}
