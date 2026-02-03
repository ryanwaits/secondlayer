/**
 * Base error class for all Stacks Streams errors
 */
export class StreamsError extends Error {
  public code: string;
  public override cause?: unknown;

  constructor(
    code: string,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
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
 * Webhook delivery error
 */
export class WebhookDeliveryError extends StreamsError {
  constructor(
    message: string,
    public statusCode?: number,
    cause?: unknown
  ) {
    super("WEBHOOK_DELIVERY_ERROR", message, cause);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
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
