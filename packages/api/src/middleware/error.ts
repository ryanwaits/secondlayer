import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod/v4";
import {
  StreamsError,
  CODE_TO_STATUS,
} from "@secondlayer/shared/errors";

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
          details: error.issues.map((e) => ({
            path: e.path.map(String).join("."),
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

    // Code-based matching — works across bundle boundaries
    if ("code" in error && typeof (error as any).code === "string") {
      const code = (error as any).code as string;
      const status = CODE_TO_STATUS[code];
      if (status) {
        return c.json({ error: error.message, code }, status);
      }
    }

    // Fallback instanceof checks for StreamsError subtypes without mapped codes
    if (error instanceof StreamsError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
        },
        500
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
