export const ErrorCodes = {
	STREAM_NOT_FOUND: "STREAM_NOT_FOUND",
	VALIDATION_ERROR: "VALIDATION_ERROR",
	DATABASE_ERROR: "DATABASE_ERROR",
	DELIVERY_ERROR: "DELIVERY_ERROR",
	FILTER_EVALUATION_ERROR: "FILTER_EVALUATION_ERROR",
	AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
	AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
	RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
	FORBIDDEN: "FORBIDDEN",
	VERSION_CONFLICT: "VERSION_CONFLICT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base error class for all Stacks Streams errors
 */
export class StreamsError extends Error {
	public code: ErrorCode;
	public override cause?: unknown;

	constructor(code: ErrorCode, message: string, cause?: unknown) {
		super(message);
		this.code = code;
		this.cause = cause;
		this.name = this.constructor.name;
		Error.captureStackTrace?.(this, this.constructor);
	}

	toJSON(): {
		name: string;
		code: string;
		message: string;
		stack: string | undefined;
		cause: unknown;
	} {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			stack: this.stack,
			cause: this.cause,
		};
	}
}

/**
 * Stream not found error
 */
export class StreamNotFoundError extends StreamsError {
	constructor(streamId: string) {
		super("STREAM_NOT_FOUND", `Stream not found: ${streamId}`);
	}
}

/**
 * Validation error for invalid input
 */
export class ValidationError extends StreamsError {
	constructor(message: string, cause?: unknown) {
		super("VALIDATION_ERROR", message, cause);
	}
}

/**
 * Database operation error
 */
export class DatabaseError extends StreamsError {
	constructor(message: string, cause?: unknown) {
		super("DATABASE_ERROR", message, cause);
	}
}

/**
 * Delivery error
 */
export class DeliveryError extends StreamsError {
	constructor(
		message: string,
		public statusCode?: number,
		cause?: unknown,
	) {
		super("DELIVERY_ERROR", message, cause);
	}

	override toJSON(): {
		name: string;
		code: string;
		message: string;
		stack: string | undefined;
		cause: unknown;
		statusCode: number | undefined;
	} {
		const base = super.toJSON();
		return {
			name: base.name,
			code: base.code,
			message: base.message,
			stack: base.stack,
			cause: base.cause,
			statusCode: this.statusCode,
		};
	}
}

/**
 * Filter evaluation error
 */
export class FilterEvaluationError extends StreamsError {
	constructor(message: string, cause?: unknown) {
		super("FILTER_EVALUATION_ERROR", message, cause);
	}
}

export class AuthenticationError extends StreamsError {
	constructor(message: string) {
		super("AUTHENTICATION_ERROR", message);
	}
}

export class AuthorizationError extends StreamsError {
	constructor(message: string) {
		super("AUTHORIZATION_ERROR", message);
	}
}

export class RateLimitError extends StreamsError {
	constructor(message: string) {
		super("RATE_LIMIT_ERROR", message);
	}
}

export class ForbiddenError extends StreamsError {
	constructor(message = "Forbidden") {
		super("FORBIDDEN", message);
	}
}

export class VersionConflictError extends StreamsError {
	public currentVersion: string;
	public expectedVersion: string;

	constructor(currentVersion: string, expectedVersion: string) {
		super(
			"VERSION_CONFLICT",
			`Version conflict: expected ${expectedVersion}, current ${currentVersion}`,
		);
		this.currentVersion = currentVersion;
		this.expectedVersion = expectedVersion;
	}
}

/** Error code → HTTP status. Used by API middleware for code-based matching
 *  (avoids cross-bundle instanceof failures from bunup class duplication). */
type MappedCode = Extract<
	ErrorCode,
	| "AUTHENTICATION_ERROR"
	| "AUTHORIZATION_ERROR"
	| "RATE_LIMIT_ERROR"
	| "FORBIDDEN"
	| "STREAM_NOT_FOUND"
	| "VALIDATION_ERROR"
>;
export const CODE_TO_STATUS: Record<MappedCode, 400 | 401 | 403 | 404 | 429> = {
	AUTHENTICATION_ERROR: 401,
	AUTHORIZATION_ERROR: 403,
	RATE_LIMIT_ERROR: 429,
	FORBIDDEN: 403,
	STREAM_NOT_FOUND: 404,
	VALIDATION_ERROR: 400,
} as const;

/**
 * Safely extract error message from unknown error value
 */
export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
