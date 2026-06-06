import type { ByoBreakingChangeDetails } from "@secondlayer/shared/errors";

export type { ByoBreakingChangeDetails };

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
		/** Stable machine-readable code from the API's `{error, code}` error envelope. */
		public code?: string,
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

/**
 * Thrown when a BYO subgraph deploy is refused for a breaking schema change.
 * The deploy did NOT run — `details.plan` carries the DROP + rebuild DDL to run
 * manually on your own database, plus the breaking `reasons` and the `diff`.
 *
 * @example
 * ```ts
 * try {
 *   await client.subgraphs.deploy(bundle);
 * } catch (err) {
 *   if (err instanceof ByoBreakingChangeError) {
 *     console.log(err.details.plan.dropStatement);
 *     console.log(err.details.plan.statements.join(";\n"));
 *   }
 * }
 * ```
 */
export class ByoBreakingChangeError extends ApiError {
	readonly details: ByoBreakingChangeDetails;
	constructor(message: string, details: ByoBreakingChangeDetails) {
		super(422, message, details, "BYO_BREAKING_CHANGE");
		this.name = "ByoBreakingChangeError";
		this.details = details;
	}
}

/** Narrow an unknown error body's `details` to {@link ByoBreakingChangeDetails}. */
export function isByoBreakingDetails(
	x: unknown,
): x is ByoBreakingChangeDetails {
	if (!x || typeof x !== "object") return false;
	const d = x as Record<string, unknown>;
	const plan = d.plan as Record<string, unknown> | undefined;
	return (
		Array.isArray(d.reasons) &&
		!!plan &&
		typeof plan === "object" &&
		typeof plan.dropStatement === "string"
	);
}
