// AuthError / RateLimitError / ValidationError are shared across the whole SDK
// (Index and the platform clients throw them too) and live in ../errors.ts —
// re-exported here so `@secondlayer/sdk/streams` imports keep working.
import { parseErrorEnvelope } from "../base.ts";
import {
	ApiError,
	AuthError,
	RateLimitError,
	SecondLayerError,
	ValidationError,
} from "../errors.ts";

export { AuthError, RateLimitError, ValidationError } from "../errors.ts";

/** Thrown on a 5xx from the Streams API, and on a failed signing-key fetch.
 *  `retryable`: the page retry policy tries again. */
export class StreamsServerError extends ApiError {
	constructor(message: string, status: number, body?: unknown, code?: string) {
		super(status, message, body, code, { retryable: true });
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

/** Map a non-OK Streams response onto the SDK error family. The server's
 *  `{error, code}` envelope survives on `message`/`code`/`body`, the same way
 *  it does on Index reads, so `err.code === "CURSOR_INVALID"` branches the
 *  same whichever client raised it. */
export async function mapStreamsError(response: Response): Promise<never> {
	const { message, code, body } = parseErrorEnvelope(await response.text());

	if (response.status === 401) {
		throw new AuthError(message ?? "API key invalid or expired.", body, code);
	}

	if (response.status === 429) {
		const retryAfter = response.headers.get("Retry-After") ?? undefined;
		throw new RateLimitError(
			message ?? "Rate limited. Try again later.",
			retryAfter,
			body,
			code,
		);
	}

	if (response.status >= 500) {
		throw new StreamsServerError(
			message ?? `Streams server returned ${response.status}.`,
			response.status,
			body,
			code,
		);
	}

	throw new ValidationError(
		message ?? `Streams request returned ${response.status}.`,
		response.status,
		body,
		code,
	);
}
