import { BaseError } from "./base.ts";

/** Thrown by the HTTP transport when a response's status isn't 2xx. */
export class HttpRequestError extends BaseError {
	override name = "HttpRequestError";
	status: number;

	constructor(status: number, options?: { cause?: Error; details?: string }) {
		super(`HTTP request failed with status ${status}`, options);
		this.status = status;
	}
}
