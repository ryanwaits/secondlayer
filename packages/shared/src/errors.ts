export const ErrorCodes = {
	VALIDATION_ERROR: "VALIDATION_ERROR",
	DATABASE_ERROR: "DATABASE_ERROR",
	AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
	AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
	RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
	FORBIDDEN: "FORBIDDEN",
	VERSION_CONFLICT: "VERSION_CONFLICT",
	NOT_FOUND: "NOT_FOUND",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Base error class for all Secondlayer errors. */
export class SecondLayerError extends Error {
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

export class NotFoundError extends SecondLayerError {
	constructor(message: string) {
		super("NOT_FOUND", message);
	}
}

export class ValidationError extends SecondLayerError {
	constructor(message: string, cause?: unknown) {
		super("VALIDATION_ERROR", message, cause);
	}
}

export class DatabaseError extends SecondLayerError {
	constructor(message: string, cause?: unknown) {
		super("DATABASE_ERROR", message, cause);
	}
}

export class AuthenticationError extends SecondLayerError {
	constructor(message: string) {
		super("AUTHENTICATION_ERROR", message);
	}
}

export class AuthorizationError extends SecondLayerError {
	constructor(message: string) {
		super("AUTHORIZATION_ERROR", message);
	}
}

export class RateLimitError extends SecondLayerError {
	constructor(message: string) {
		super("RATE_LIMIT_ERROR", message);
	}
}

export class ForbiddenError extends SecondLayerError {
	constructor(message = "Forbidden") {
		super("FORBIDDEN", message);
	}
}

export class VersionConflictError extends SecondLayerError {
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
	| "NOT_FOUND"
	| "VALIDATION_ERROR"
>;
export const CODE_TO_STATUS: Record<MappedCode, 400 | 401 | 403 | 404 | 429> = {
	AUTHENTICATION_ERROR: 401,
	AUTHORIZATION_ERROR: 403,
	RATE_LIMIT_ERROR: 429,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	VALIDATION_ERROR: 400,
} as const;

export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
