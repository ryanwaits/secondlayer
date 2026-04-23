/**
 * Error thrown by {@link SecondLayer} when an API request fails.
 * Includes the HTTP status code for programmatic error handling.
 *
 * @example
 * ```ts
 * try {
 *   await client.subgraphs.get("my-subgraph");
 * } catch (err) {
 *   if (err instanceof ApiError && err.status === 404) {
 *     console.log("Subgraph not found");
 *   }
 * }
 * ```
 */
export class ApiError extends Error {
	constructor(
		/** HTTP status code (0 for network errors). */
		public status: number,
		message: string,
		/** Raw response body (parsed JSON if possible) — preserved for callers that need error details. */
		public body?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * Thrown on optimistic-concurrency conflict when a deploy supplies an
 * `expectedVersion` that no longer matches the server's stored version.
 */
export class VersionConflictError extends ApiError {
	constructor(
		public currentVersion: string,
		public expectedVersion: string,
		message = `Version conflict: expected ${expectedVersion}, current ${currentVersion}`,
	) {
		super(409, message, { currentVersion, expectedVersion });
		this.name = "VersionConflictError";
	}
}
