/**
 * Unified verify targets — library used by CLI (and REST later).
 * Exit codes match `sl verify`: 0 clean, 1 diverged, 2 unanchored.
 */

export const VERIFY_EXIT = {
	CLEAN: 0,
	DIVERGED: 1,
	UNANCHORED: 2,
} as const;
export type VerifyExit = (typeof VERIFY_EXIT)[keyof typeof VERIFY_EXIT];

export type VerifyTarget =
	| { kind: "all" }
	| { kind: "raw" }
	| { kind: "decode"; name: string }
	| { kind: "subgraph"; name: string };

export type VerifyMode = "quick" | "deep" | "anchor";

export function parseVerifyTarget(value: string | undefined): VerifyTarget {
	const raw = (value ?? "raw").trim();
	if (raw === "all") return { kind: "all" };
	if (raw === "raw" || raw === "") return { kind: "raw" };
	if (raw.startsWith("decode:")) {
		const name = raw.slice("decode:".length).trim();
		if (!name) throw new Error("decode: target needs a decoder name");
		return { kind: "decode", name };
	}
	if (raw.startsWith("subgraph:")) {
		const name = raw.slice("subgraph:".length).trim();
		if (!name) throw new Error("subgraph: target needs a subgraph name");
		return { kind: "subgraph", name };
	}
	throw new Error(
		`verify target must be all | raw | decode:<name> | subgraph:<name> (got ${value})`,
	);
}

const RAW_DATASETS = new Set(["blocks", "transactions", "events"]);

/** Whether an archive/coverage dataset belongs to this verify target. */
export function datasetMatchesTarget(
	dataset: string,
	target: VerifyTarget,
): boolean {
	if (target.kind === "all") return true;
	const name = dataset.toLowerCase();
	if (target.kind === "raw") return RAW_DATASETS.has(name);
	if (target.kind === "decode") {
		return (
			name === target.name.toLowerCase() ||
			name === `decode:${target.name.toLowerCase()}` ||
			name.endsWith(`_${target.name.toLowerCase()}`)
		);
	}
	return (
		name === target.name.toLowerCase() ||
		name === `subgraph:${target.name.toLowerCase()}` ||
		name.startsWith(`${target.name.toLowerCase()}_`)
	);
}

export type VerifyReport = {
	target: VerifyTarget;
	mode: VerifyMode;
	exit: VerifyExit;
	status: "clean" | "diverged" | "unanchored";
	detail: string;
};

export function reportVerify(opts: {
	target: VerifyTarget;
	mode?: VerifyMode;
	anchored?: boolean;
	diverged?: boolean;
	detail?: string;
}): VerifyReport {
	const mode = opts.mode ?? "quick";
	if (opts.anchored === false) {
		return {
			target: opts.target,
			mode,
			exit: VERIFY_EXIT.UNANCHORED,
			status: "unanchored",
			detail: opts.detail ?? "reference unavailable or unverifiable",
		};
	}
	if (opts.diverged) {
		return {
			target: opts.target,
			mode,
			exit: VERIFY_EXIT.DIVERGED,
			status: "diverged",
			detail: opts.detail ?? "coverage or archive diverged",
		};
	}
	const label =
		opts.target.kind === "decode"
			? `decode:${opts.target.name}`
			: opts.target.kind === "subgraph"
				? `subgraph:${opts.target.name}`
				: opts.target.kind;
	return {
		target: opts.target,
		mode,
		exit: VERIFY_EXIT.CLEAN,
		status: "clean",
		detail: opts.detail ?? `${label} ${mode} is clean`,
	};
}
