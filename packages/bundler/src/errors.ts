export class BundleSizeError extends Error {
	readonly kind: "subgraph" | "workflow";
	readonly actualBytes: number;
	readonly maxBytes: number;

	constructor(
		kind: "subgraph" | "workflow",
		actualBytes: number,
		maxBytes: number,
	) {
		super(
			`${kind} bundle exceeds ${maxBytes} bytes (actual: ${actualBytes} bytes)`,
		);
		this.name = "BundleSizeError";
		this.kind = kind;
		this.actualBytes = actualBytes;
		this.maxBytes = maxBytes;
	}
}

export const SUBGRAPH_BUNDLE_MAX_BYTES: number = 4 * 1024 * 1024;
export const WORKFLOW_BUNDLE_MAX_BYTES: number = 4 * 1024 * 1024;
