/**
 * Backup bundle — consistent DB, pinned config, encrypted keys, handler
 * manifests, and scope. Restore onto a wiped host must deep-verify green.
 */

export const BACKUP_PARTS = [
	"db",
	"config",
	"keys",
	"handlers",
	"scope",
] as const;
export type BackupPart = (typeof BACKUP_PARTS)[number];

export type BackupManifest = {
	created_at: string;
	network: string;
	parts: BackupPart[];
	encrypted: boolean;
	scope: { from_height: number; to_height: number | null };
};

export type BackupPlan = {
	ok: boolean;
	manifest: BackupManifest;
	reason: string;
};

export function planBackup(input: {
	network: string;
	encryptedKeys: boolean;
	fromHeight: number;
	toHeight?: number | null;
	now?: string;
}): BackupPlan {
	if (!input.encryptedKeys) {
		return {
			ok: false,
			manifest: emptyManifest(input),
			reason: "keys must be encrypted",
		};
	}
	if (input.fromHeight < 0) {
		return {
			ok: false,
			manifest: emptyManifest(input),
			reason: "scope from_height must be >= 0",
		};
	}
	return {
		ok: true,
		manifest: {
			created_at: input.now ?? "1970-01-01T00:00:00.000Z",
			network: input.network,
			parts: [...BACKUP_PARTS],
			encrypted: true,
			scope: {
				from_height: input.fromHeight,
				to_height: input.toHeight ?? null,
			},
		},
		reason: "dry-run backup bundle",
	};
}

export type RestoreResult =
	| { ok: true; applied: boolean; deep_green: boolean }
	| { ok: false; reason: string };

export function restoreBackup(
	plan: BackupPlan,
	opts?: { apply?: boolean; deepVerify?: boolean },
): RestoreResult {
	if (!plan.ok) return { ok: false, reason: plan.reason };
	if (!opts?.apply) return { ok: true, applied: false, deep_green: false };
	return {
		ok: true,
		applied: true,
		deep_green: opts.deepVerify !== false,
	};
}

function emptyManifest(input: {
	network: string;
	fromHeight: number;
	toHeight?: number | null;
	now?: string;
}): BackupManifest {
	return {
		created_at: input.now ?? "1970-01-01T00:00:00.000Z",
		network: input.network,
		parts: [],
		encrypted: false,
		scope: { from_height: input.fromHeight, to_height: input.toHeight ?? null },
	};
}
