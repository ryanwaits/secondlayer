/**
 * Derive a stable machine-readable code from an error's `name` field:
 * `HttpRequestError` becomes `HTTP_REQUEST_ERROR`. `name` is a string
 * literal each class sets, so the code survives a bundler that mangles
 * class names. Branch on `code` instead of parsing `message`, which is
 * free to change.
 */
function codeFromName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.toUpperCase();
}

export class BaseError extends Error {
	override name = "StacksError";
	#code?: string;
	shortMessage: string;
	details?: string;

	constructor(
		shortMessage: string,
		options?: { cause?: Error; details?: string; code?: string },
	) {
		const message = [
			shortMessage,
			options?.details ? `\n${options.details}` : "",
		].join("");

		super(message, { cause: options?.cause });
		if (options?.code !== undefined) this.#code = options.code;
		this.shortMessage = shortMessage;
		this.details = options?.details;
	}

	/**
	 * Stable identifier for programmatic handling; survives message
	 * rewording and minification. An explicit `code` option wins, else it
	 * is derived from `name` (`TimeoutError` gives `TIMEOUT_ERROR`).
	 */
	get code(): string {
		return this.#code ?? codeFromName(this.name);
	}

	set code(value: string) {
		this.#code = value;
	}

	toJSON(): {
		name: string;
		code: string;
		message: string;
		shortMessage: string;
		details: string | undefined;
		cause: string | undefined;
	} {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			shortMessage: this.shortMessage,
			details: this.details,
			cause: this.cause instanceof Error ? this.cause.message : undefined,
		};
	}
}
