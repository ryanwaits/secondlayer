const DOCS_BASE = "https://www.secondlayer.tools";

/** Options accepted by every error in the family. */
export interface SecondLayerErrorOptions {
	cause?: Error;
	details?: string;
	/** Stable machine-readable code (e.g. `UPGRADE_REQUIRED`). */
	code?: string;
	/** Docs page that explains this failure and its fix. */
	docsUrl?: string;
	/** Extra context lines appended to the message (DDL to run, next steps). */
	metaMessages?: string[];
	/** Whether retrying the SAME request can succeed (429/5xx/network). */
	retryable?: boolean;
	/** Parsed `Retry-After`, in seconds — set on rate limits that carry it. */
	retryAfterSeconds?: number;
}

/**
 * Root of the SDK error family. Implements the same protocol as `BaseError`
 * in `@secondlayer/stacks` (`shortMessage`, `cause`, `toJSON`) so a failed
 * chain read and a failed platform read serialize and introspect identically.
 * It intentionally does NOT extend that class: cross-package `instanceof` is
 * unreliable under per-package bundling anyway (match on `code`/`name` across
 * packages).
 *
 * `retryable` is the signal the consume loops act on: 429/5xx/network are
 * retryable, 4xx and body-serialization failures are not.
 */
export class SecondLayerError extends Error {
	override name = "SecondLayerError";
	/** The one-line failure, without the appended context blocks. */
	shortMessage: string;
	code?: string;
	docsUrl?: string;
	metaMessages?: string[];
	retryable: boolean;
	retryAfterSeconds?: number;

	constructor(shortMessage: string, options: SecondLayerErrorOptions = {}) {
		const detailBlocks = [
			...(options.metaMessages ?? []),
			...(options.details ? [options.details] : []),
			...(options.docsUrl ? [`Docs: ${options.docsUrl}`] : []),
		];
		const message = [
			shortMessage,
			detailBlocks.length > 0 ? `\n${detailBlocks.join("\n")}` : "",
		].join("");
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.shortMessage = shortMessage;
		this.code = options.code;
		this.docsUrl = options.docsUrl;
		this.metaMessages = options.metaMessages;
		this.retryable = options.retryable ?? false;
		this.retryAfterSeconds = options.retryAfterSeconds;
	}

	/**
	 * Walk the cause chain. With a predicate, returns the first error matching
	 * it (or `null`); without one, returns the deepest cause. Mirrors viem's
	 * `error.walk()` so cross-library error handling reads the same.
	 */
	walk(fn?: (err: unknown) => boolean): unknown {
		// biome-ignore lint/suspicious/noExplicitAny: cause chains are untyped by nature
		let err: any = this;
		let last: unknown = this;
		while (err != null) {
			if (fn?.(err)) return err;
			last = err;
			err = err.cause;
		}
		return fn ? null : last;
	}

	toJSON(): {
		name: string;
		message: string;
		shortMessage: string;
		cause: string | undefined;
		code: string | undefined;
		docsUrl: string | undefined;
		retryable: boolean;
		retryAfterSeconds: number | undefined;
	} {
		return {
			name: this.name,
			message: this.message,
			shortMessage: this.shortMessage,
			cause: this.cause instanceof Error ? this.cause.message : undefined,
			code: this.code,
			docsUrl: this.docsUrl,
			retryable: this.retryable,
			retryAfterSeconds: this.retryAfterSeconds,
		};
	}
}

/** Retryability of an HTTP status: 429 and 5xx are transient. */
function statusRetryable(status: number): boolean {
	return status === 429 || status >= 500;
}

/** Docs page for a status/code pair, when one exists. */
function docsFor(status: number, code?: string): string | undefined {
	if (code === "UPGRADE_REQUIRED" || status === 402)
		return `${DOCS_BASE}/docs/authentication#pay-as-you-go-credits`;
	if (status === 429 || status === 401)
		return `${DOCS_BASE}/docs/authentication`;
	return undefined;
}

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
export class ApiError extends SecondLayerError {
	constructor(
		/** HTTP status code (0 for network errors). */
		public status: number,
		message: string,
		/** Raw response body (parsed JSON if possible) — preserved for callers that need error details. */
		public body?: unknown,
		/** Stable machine-readable code from the API's `{error, code}` error envelope. */
		code?: string,
		options: SecondLayerErrorOptions = {},
	) {
		super(message, {
			code,
			retryable: options.retryable ?? statusRetryable(status),
			docsUrl: options.docsUrl ?? docsFor(status, code),
			...(options.cause ? { cause: options.cause } : {}),
			...(options.details ? { details: options.details } : {}),
			...(options.metaMessages ? { metaMessages: options.metaMessages } : {}),
			...(options.retryAfterSeconds !== undefined
				? { retryAfterSeconds: options.retryAfterSeconds }
				: {}),
		});
		this.name = "ApiError";
	}
}

/** Thrown on a 401 — by both the platform clients and Streams. */
export class AuthError extends ApiError {
	override readonly status = 401 as const;

	constructor(message = "API key invalid or expired.") {
		super(401, message);
		this.name = "AuthError";
	}
}

/** Thrown on a 429 — by both the platform clients and Streams. `retryable`,
 *  with `retryAfterSeconds` parsed from the `Retry-After` header when sent. */
export class RateLimitError extends ApiError {
	override readonly status = 429 as const;

	constructor(
		message = "Rate limited. Try again later.",
		/** Raw `Retry-After` header value (seconds or HTTP-date). */
		readonly retryAfter?: string,
	) {
		super(429, message, undefined, undefined, {
			retryable: true,
			retryAfterSeconds: parseRetryAfter(retryAfter),
		});
		this.name = "RateLimitError";
	}
}

/** Thrown on a 4xx the caller can fix (bad cursor, bad params). Never retried. */
export class ValidationError extends ApiError {
	constructor(message: string, status: number, body?: unknown) {
		super(status, message, body, undefined, { retryable: false });
		this.name = "ValidationError";
	}
}

/** Parse a `Retry-After` header: delta-seconds or an HTTP-date. */
export function parseRetryAfter(value?: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds;
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
	return undefined;
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
