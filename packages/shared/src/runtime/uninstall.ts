/**
 * Uninstall with data preservation — tear the stack down without destroying
 * what cannot be rebuilt.
 *
 * The asymmetry that shapes this whole file: the index can be reconstructed
 * from the archive, and the chainstate can be re-synced, but the keys cannot be
 * recovered by any means. `SECONDLAYER_SECRETS_KEY` decrypts columns that are
 * otherwise permanently unreadable, and `STREAMS_SIGNING_PRIVATE_KEY` is the
 * identity anything this instance published was signed under.
 *
 * So the default removes containers and leaves every byte of data in place, and
 * the destructive path refuses unless the operator has said the words AND the
 * keys are demonstrably somewhere else. A teardown that silently takes the keys
 * with it is not an uninstall, it is data loss with a friendly name.
 */

export const REMOVABLE = ["containers", "networks", "handler-cache"] as const;
export type Removable = (typeof REMOVABLE)[number];

export const PRESERVED = ["index", "chainstate", "secrets", "backups"] as const;
export type Preserved = (typeof PRESERVED)[number];

export type UninstallPlan = {
	/** What the plan will actually delete. */
	removes: Removable[];
	/** What survives, and why it matters. */
	preserves: { what: Preserved; detail: string }[];
	/** Volumes destroyed only on the purge path. */
	destroys: string[];
	purge: boolean;
};

export type UninstallDecision =
	| { ok: true; plan: UninstallPlan; warnings: string[] }
	| { ok: false; reason: string };

export function planUninstall(input: {
	purge: boolean;
	/** The operator typed the confirmation. */
	confirmed: boolean;
	/** A backup bundle exists that carries the keys. */
	keysBackedUp: boolean;
	/** Secrets are currently present (there is something to lose). */
	secretsPresent: boolean;
	dataDir: string;
}): UninstallDecision {
	const preserves: UninstallPlan["preserves"] = [
		{
			what: "index",
			detail: "the Postgres volume — rebuildable from the archive, but slow",
		},
		{
			what: "chainstate",
			detail: "bundled node data, if any — re-syncable",
		},
		{
			what: "secrets",
			detail: `${input.dataDir} and .env.local — NOT recoverable if lost`,
		},
		{ what: "backups", detail: "any bundles already written" },
	];

	if (!input.purge) {
		return {
			ok: true,
			warnings: [],
			plan: {
				removes: [...REMOVABLE],
				preserves,
				destroys: [],
				purge: false,
			},
		};
	}

	// Purge is the only path that can lose something irreplaceable, so both
	// gates are required and neither is implied by the other.
	if (!input.confirmed) {
		return {
			ok: false,
			reason:
				"purge destroys the index and every volume; re-run with the explicit confirmation flag",
		};
	}
	if (input.secretsPresent && !input.keysBackedUp) {
		return {
			ok: false,
			reason:
				"refusing to purge: this instance holds keys with no backup bundle. Run `secondlayer backup` first — the index can be rebuilt from the archive, the keys cannot.",
		};
	}

	return {
		ok: true,
		warnings: [
			"purge removes the index; a rebuild from the archive takes hours",
		],
		plan: {
			removes: [...REMOVABLE],
			// Even on purge the secrets on disk are left alone: the operator asked
			// to destroy the stack's data, not to shred their own key material.
			preserves: preserves.filter((p) => p.what === "secrets"),
			destroys: ["postgres_data", "subgraphs_data"],
			purge: true,
		},
	};
}

/** The compose invocation a plan corresponds to. */
export function uninstallCommand(
	plan: UninstallPlan,
	composeFile: string,
): string[] {
	const base = ["compose", "-f", composeFile, "down", "--remove-orphans"];
	return plan.purge ? [...base, "-v"] : base;
}
