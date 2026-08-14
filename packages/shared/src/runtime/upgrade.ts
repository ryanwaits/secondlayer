/**
 * Upgrade contract — pin image, preflight schema/disk, backup first,
 * migrate, health/verify, document rollback limits.
 */

export const UPGRADE_STEPS = [
	"pin",
	"preflight",
	"backup",
	"migrate",
	"health",
	"verify",
] as const;
export type UpgradeStep = (typeof UPGRADE_STEPS)[number];

export type UpgradePlan = {
	from: string;
	to: string;
	steps: UpgradeStep[];
	ok: boolean;
	reason: string;
	rollback: string;
};

export function planUpgrade(input: {
	from: string;
	to: string;
	diskOk: boolean;
	schemaOk: boolean;
	backupDone: boolean;
	supported?: readonly string[];
}): UpgradePlan {
	const rollback =
		"roll back to the pinned previous image; schema migrations are forward-only";
	if (input.from === input.to) {
		return {
			from: input.from,
			to: input.to,
			steps: [],
			ok: false,
			reason: "from and to are the same image",
			rollback,
		};
	}
	if (input.supported && !input.supported.includes(input.to)) {
		return {
			from: input.from,
			to: input.to,
			steps: [],
			ok: false,
			reason: `image ${input.to} is not in the supported matrix`,
			rollback,
		};
	}
	if (!input.diskOk) {
		return {
			from: input.from,
			to: input.to,
			steps: ["pin", "preflight"],
			ok: false,
			reason: "disk preflight failed",
			rollback,
		};
	}
	if (!input.schemaOk) {
		return {
			from: input.from,
			to: input.to,
			steps: ["pin", "preflight"],
			ok: false,
			reason: "schema preflight failed",
			rollback,
		};
	}
	if (!input.backupDone) {
		return {
			from: input.from,
			to: input.to,
			steps: ["pin", "preflight", "backup"],
			ok: false,
			reason: "backup required before migrate",
			rollback,
		};
	}
	return {
		from: input.from,
		to: input.to,
		steps: [...UPGRADE_STEPS],
		ok: true,
		reason: "dry-run upgrade",
		rollback,
	};
}

export function applyUpgrade(
	plan: UpgradePlan,
	opts?: { apply?: boolean },
): { ok: boolean; applied: boolean; reason: string } {
	if (!plan.ok) return { ok: false, applied: false, reason: plan.reason };
	if (!opts?.apply) return { ok: true, applied: false, reason: plan.reason };
	return { ok: true, applied: true, reason: "upgrade applied" };
}
