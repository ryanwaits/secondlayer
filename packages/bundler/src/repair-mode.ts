/**
 * Conservative repair-mode inference from subgraph source.
 * Chain reads, accumulators, and unknown operations default to full_reindex.
 */

export const REPAIR_MODES = ["range_safe", "full_reindex"] as const;
export type InferredRepairMode = (typeof REPAIR_MODES)[number];

const FULL_REINDEX_MARKERS: readonly { reason: string; pattern: RegExp }[] = [
	{ reason: "chain read", pattern: /ctx\.client\b/ },
	{ reason: "chain read", pattern: /\.readOnly\b/ },
	{ reason: "accumulator", pattern: /ctx\.increment\b/ },
	{ reason: "accumulator", pattern: /\bincrement\s*\(/ },
	{ reason: "accumulator", pattern: /ON CONFLICT/i },
	{ reason: "accumulator", pattern: /accumulator/i },
	{ reason: "unknown operation", pattern: /eval\s*\(/ },
	{ reason: "unknown operation", pattern: /new Function\b/ },
];

export type RepairModeEvidence = {
	mode: InferredRepairMode;
	reasons: string[];
};

export function inferRepairMode(source: string): RepairModeEvidence {
	const reasons: string[] = [];
	for (const marker of FULL_REINDEX_MARKERS) {
		if (marker.pattern.test(source)) reasons.push(marker.reason);
	}
	const unique = [...new Set(reasons)];
	if (unique.length > 0) {
		return { mode: "full_reindex", reasons: unique };
	}
	if (
		!/defineSubgraph\s*\(/.test(source) &&
		!/ctx\.(set|insert|update|delete)/.test(source)
	) {
		return { mode: "full_reindex", reasons: ["unknown operation"] };
	}
	return { mode: "range_safe", reasons: [] };
}

export function inferRepairModeFromHandlers(
	handlerSources: Record<string, string>,
): RepairModeEvidence {
	const reasons: string[] = [];
	let mode: InferredRepairMode = "range_safe";
	for (const [name, body] of Object.entries(handlerSources)) {
		const inferred = inferRepairMode(body);
		if (inferred.mode === "full_reindex") {
			mode = "full_reindex";
			for (const reason of inferred.reasons) {
				reasons.push(`${name}: ${reason}`);
			}
		}
	}
	if (Object.keys(handlerSources).length === 0) {
		return { mode: "full_reindex", reasons: ["unknown operation"] };
	}
	return { mode, reasons: [...new Set(reasons)] };
}
