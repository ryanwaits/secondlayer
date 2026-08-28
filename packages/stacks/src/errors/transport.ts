import { BaseError } from "./base.ts";

/**
 * Thrown by the HTTP transport when a request, headers and body included,
 * does not finish inside `timeout`. Carries enough to tell which endpoint
 * stalled and on which retry attempt. A caller-supplied `signal` abort is
 * NOT a timeout: that rejects with the signal's own reason and never retries.
 */
export class TimeoutError extends BaseError {
	override name = "TimeoutError";
	method: string;
	url: string;
	timeout: number;
	/** Zero-based attempt index at which the timeout fired. */
	attempt: number;

	constructor(params: {
		method: string;
		url: string;
		timeout: number;
		attempt: number;
	}) {
		super(
			`${params.method} ${params.url} did not complete within ${params.timeout}ms (attempt ${params.attempt + 1})`,
		);
		this.method = params.method;
		this.url = params.url;
		this.timeout = params.timeout;
		this.attempt = params.attempt;
	}
}
