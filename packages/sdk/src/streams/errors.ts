export class AuthError extends Error {
	readonly status = 401;

	constructor(message = "API key invalid or expired.") {
		super(message);
		this.name = "AuthError";
	}
}

export class RateLimitError extends Error {
	readonly status = 429;

	constructor(
		message = "Rate limited. Try again later.",
		readonly retryAfter?: string,
	) {
		super(message);
		this.name = "RateLimitError";
	}
}

export class ValidationError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "ValidationError";
	}
}

export class StreamsServerError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "StreamsServerError";
	}
}
