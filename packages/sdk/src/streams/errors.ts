// AuthError / RateLimitError / ValidationError are shared across the whole SDK
// (Index and the platform clients throw them too) and live in ../errors.ts —
// re-exported here so `@secondlayer/sdk/streams` imports keep working.
import { ApiError, SecondLayerError } from "../errors.ts";

export { AuthError, RateLimitError, ValidationError } from "../errors.ts";

/** Thrown on a 5xx from the Streams API. `retryable`. */
export class StreamsServerError extends ApiError {
	constructor(message: string, status: number, body?: unknown) {
		super(status, message, body, undefined, { retryable: true });
		this.name = "StreamsServerError";
	}
}

/** Thrown when response signature verification is enabled and fails. */
export class StreamsSignatureError extends SecondLayerError {
	constructor(message = "Streams response signature verification failed.") {
		super(message);
		this.name = "StreamsSignatureError";
	}
}
