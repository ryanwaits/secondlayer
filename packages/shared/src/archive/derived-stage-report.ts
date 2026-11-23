import { ARCHIVE_DATASETS, type ArchiveDataset } from "./datasets.ts";

export const DERIVED_STAGE_REPORT_SCHEMA_VERSION = 1 as const;

export type ServiceKind =
	| "decoder"
	| "subgraph-runtime"
	| "webhook-runtime"
	| "protocol-producer";

export type CanonicalInput = ArchiveDataset;

export interface ExternalInput {
	/** Short name for the dependency: `stacks-node-rpc`, `hiro-extended-api`,
	 *  `observer-journal`, `contract-source-registry`, etc. */
	name: string;
	/** Why the archive can't provide this. One sentence. */
	reason: string;
	/** Where an operator can source it. `bundled-stacks`, `own-node`,
	 *  `hiro-public-api`, `re-derive-from-events`, `manual-import`. */
	source: string;
	/** True if the archive supplies enough to re-derive this dependency
	 *  without a live external source. Rare but happens (e.g. contract ABIs
	 *  derivable from `transactions.raw_tx`). */
	rebuildable_from_archive: boolean;
}

export interface Output {
	/** Table/topic/queue name in the operator's runtime. */
	target: string;
	/** How the operator verifies this output — e.g. `row-count`,
	 *  `semantic-digest`, `effect-manifest`, `dlq-empty`. */
	verification: string;
}

export interface ServiceManifest {
	name: string;
	kind: ServiceKind;
	description: string;
	canonical_inputs: CanonicalInput[];
	external_inputs: ExternalInput[];
	outputs: Output[];
	/**
	 * Explicit judgment on whether R2 alone can rebuild this service.
	 * `false` REQUIRES `external_inputs` to name what else is needed.
	 */
	r2_alone_can_rebuild: boolean;
	/** When true, this service can only replay forward from a starting point
	 *  the operator supplies (e.g. a webhook consumer's last-delivered id).
	 *  Publish it, don't hide it. */
	requires_operator_state: boolean;
	/** Repo path where the service lives, for cross-reference. */
	source_path: string;
}

export interface DerivedStageReport {
	schema_version: typeof DERIVED_STAGE_REPORT_SCHEMA_VERSION;
	generated_at: string;
	services: ServiceManifest[];
}

/**
 * Compose a report from a set of registered manifests. Sorts services by name
 * so the JSON is stable across runs — a re-emit with unchanged manifests
 * produces byte-identical output, so an operator can diff two archive
 * publish cycles cleanly.
 */
export function buildDerivedStageReport(
	manifests: ReadonlyArray<ServiceManifest>,
	generatedAt: string,
): DerivedStageReport {
	const sorted = [...manifests].sort((a, b) => a.name.localeCompare(b.name));
	return {
		schema_version: DERIVED_STAGE_REPORT_SCHEMA_VERSION,
		generated_at: generatedAt,
		services: sorted,
	};
}

export type ManifestValidationIssue = {
	name: string;
	problem: string;
};

/**
 * Enforce the invariants the report shape leaves ambiguous:
 *   - `r2_alone_can_rebuild: false` REQUIRES at least one external input.
 *     Otherwise the report claims a rebuild gap it can't explain, which is
 *     worse than declaring nothing.
 *   - Names are unique — a duplicate is almost always a copy-paste that
 *     silently shadows the earlier declaration.
 *   - Every canonical_input is a real dataset name.
 */
export function validateServiceManifests(
	manifests: ReadonlyArray<ServiceManifest>,
): ManifestValidationIssue[] {
	const issues: ManifestValidationIssue[] = [];
	const seen = new Set<string>();
	const canonicalDatasets: ReadonlySet<CanonicalInput> = new Set(
		ARCHIVE_DATASETS,
	);
	for (const m of manifests) {
		if (seen.has(m.name)) {
			issues.push({ name: m.name, problem: "duplicate service name" });
		}
		seen.add(m.name);
		if (!m.r2_alone_can_rebuild && m.external_inputs.length === 0) {
			issues.push({
				name: m.name,
				problem:
					"declares r2_alone_can_rebuild=false but lists no external_inputs — the gap is undocumented",
			});
		}
		for (const input of m.canonical_inputs) {
			if (!canonicalDatasets.has(input)) {
				issues.push({
					name: m.name,
					problem: `canonical_inputs contains unknown dataset: ${String(input)}`,
				});
			}
		}
	}
	return issues;
}
