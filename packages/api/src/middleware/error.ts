import { CODE_TO_STATUS, SecondLayerError } from "@secondlayer/shared/errors";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export class InvalidJSONError extends Error {
	code = "INVALID_JSON";
	constructor(message = "Invalid JSON body") {
		super(message);
		this.name = "InvalidJSONError";
	}
}

/** Postgres `unique_violation`. Raised under a race, after the handler's own
 *  "does it exist" check has already passed. */
export function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

/**
 * Global error handler (app.onError)
 */
export const errorHandler: ErrorHandler = (error, c) => {
	// Handle Zod validation errors
	if (error instanceof ZodError) {
		return c.json(
			{
				error: "Validation Error",
				code: "VALIDATION_ERROR",
				details: error.issues.map((e) => ({
					path: e.path.map(String).join("."),
					message: e.message,
				})),
			},
			400,
		);
	}

	// Handle invalid JSON body
	if (error instanceof InvalidJSONError) {
		return c.json(
			{
				error: error.message,
				code: error.code,
			},
			400,
		);
	}

	// A duplicate that slipped past a handler's existence check (two writers,
	// same name) is the caller's conflict, not a server fault.
	if (isUniqueViolation(error)) {
		return c.json(
			{
				error: "A resource with that name already exists",
				code: "CONFLICT",
			},
			409,
		);
	}

	// Code-based matching — works across bundle boundaries
	if ("code" in error && typeof error.code === "string") {
		const code = error.code;
		const status = (
			CODE_TO_STATUS as Record<
				string,
				400 | 401 | 402 | 403 | 404 | 409 | 415 | 422 | 423 | 429 | 503
			>
		)[code];
		if (status) {
			const details =
				"details" in error && error.details && typeof error.details === "object"
					? (error.details as Record<string, unknown>)
					: undefined;
			return c.json(
				{ error: error.message, code, ...(details ? { details } : {}) },
				status,
			);
		}
	}

	// Fallback instanceof checks for SecondLayerError subtypes without mapped codes
	if (error instanceof SecondLayerError) {
		return c.json(
			{
				error: error.message,
				code: error.code,
			},
			500,
		);
	}

	// Handle Hono HTTP exceptions
	if (error instanceof HTTPException) {
		return c.json(
			{
				error: error.message,
				code: "HTTP_ERROR",
			},
			error.status,
		);
	}

	// Unknown error
	console.error("Unhandled error:", error);
	return c.json(
		{
			error: "Internal Server Error",
			code: "INTERNAL_ERROR",
		},
		500,
	);
};
