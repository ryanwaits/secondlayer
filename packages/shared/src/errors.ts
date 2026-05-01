export const ErrorCodes = {
	VALIDATION_ERROR: "VALIDATION_ERROR",
	DATABASE_ERROR: "DATABASE_ERROR",
	AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
	AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
	RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
	FORBIDDEN: "FORBIDDEN",
	VERSION_CONFLICT: "VERSION_CONFLICT",
	NOT_FOUND: "NOT_FOUND",
	// Tenant lifecycle (CLI surfaces these verbatim)
	KEY_ROTATED: "KEY_ROTATED",
	TENANT_SUSPENDED: "TENANT_SUSPENDED",
	NO_TENANT_FOR_PROJECT: "NO_TENANT_FOR_PROJECT",
	INSTANCE_EXISTS: "INSTANCE_EXISTS",
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

export class KeyRotatedError extends SecondLayerError {
	constructor(message = "Token has been rotated") {
		super("KEY_ROTATED", message);
	}
}

export class TenantSuspendedError extends SecondLayerError {
	constructor(message = "Instance is suspended") {
		super("TENANT_SUSPENDED", message);
	}
}

/** Error code → HTTP status. Used by API middleware for code-based matching
 *  (avoids cross-bundle instanceof failures from bunup class duplication). */
// String literal map — codes don't have to be in the central ErrorCode
// enum (route-local error classes can supply any code; we just map the
// HTTP status here). This keeps cross-bundle instanceof failures out of
// the equation.
export const CODE_TO_STATUS: Record<
	string,
	400 | 401 | 403 | 404 | 409 | 423 | 429
> = {
	AUTHENTICATION_ERROR: 401,
	AUTHORIZATION_ERROR: 403,
	RATE_LIMIT_ERROR: 429,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	VALIDATION_ERROR: 400,
	KEY_ROTATED: 401,
	TENANT_SUSPENDED: 423,
	NO_TENANT_FOR_PROJECT: 404,
	INSTANCE_EXISTS: 409,
	SUBGRAPH_NOT_FOUND: 404,
} as const;

export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
