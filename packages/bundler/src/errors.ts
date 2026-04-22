export class BundleSizeError extends Error {
	readonly actualBytes: number;
	readonly maxBytes: number;

	constructor(actualBytes: number, maxBytes: number) {
		super(
			`subgraph bundle exceeds ${maxBytes} bytes (actual: ${actualBytes} bytes)`,
		);
		this.name = "BundleSizeError";
		this.actualBytes = actualBytes;
		this.maxBytes = maxBytes;
	}
}

export const SUBGRAPH_BUNDLE_MAX_BYTES: number = 4 * 1024 * 1024;
