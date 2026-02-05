import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import {
  StreamsError,
  StreamNotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
} from "@secondlayer/shared";
import { ForbiddenError } from "../lib/ownership.ts";

export class InvalidJSONError extends Error {
  code = "INVALID_JSON";
  constructor(message = "Invalid JSON body") {
    super(message);
    this.name = "InvalidJSONError";
  }
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
          details: error.errors.map((e: { path: (string | number)[]; message: string }) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        },
        400
      );
    }

    // Handle invalid JSON body
    if (error instanceof InvalidJSONError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        400
      );
    }

    // Handle custom StreamsError types
    if (error instanceof AuthenticationError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        401
      );
    }

    if (error instanceof AuthorizationError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        403
      );
    }

    if (error instanceof RateLimitError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        429
      );
    }

    if (error instanceof ForbiddenError) {
      return c.json(
        {
          error: error.message,
          code: "FORBIDDEN",
        },
        403
      );
    }

    if (error instanceof StreamNotFoundError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        404
      );
    }

    if (error instanceof ValidationError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        400
      );
    }

    if (error instanceof StreamsError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        500
      );
    }

    // Handle errors with a "code" property (e.g. ViewNotFoundError)
    if ("code" in error && (error as any).code === "VIEW_NOT_FOUND") {
      return c.json(
        {
          error: error.message,
          code: "VIEW_NOT_FOUND",
        },
        404
      );
    }

    // Handle Hono HTTP exceptions
    if (error instanceof HTTPException) {
      return c.json(
        {
          error: error.message,
          code: "HTTP_ERROR",
        },
        error.status
      );
    }

    // Unknown error
    console.error("Unhandled error:", error);
    return c.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
      },
      500
    );
};
