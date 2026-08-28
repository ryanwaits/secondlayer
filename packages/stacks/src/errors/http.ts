import { BaseError } from "./base.ts";

/** Thrown by the HTTP transport when a response's status isn't 2xx. */
export class HttpRequestError extends BaseError {
	override name = "HttpRequestError";
	status: number;
	/** Request URL, when the transport knows it. */
	url?: string;
	/** Request method, when the transport knows it. */
	method?: string;

	constructor(
		status: number,
		options?: {
			cause?: Error;
			details?: string;
			url?: string;
			method?: string;
		},
	) {
		const where =
			options?.url !== undefined
				? ` (${options.method ?? "GET"} ${options.url})`
				: "";
		super(`HTTP request failed with status ${status}${where}`, options);
		this.status = status;
		this.url = options?.url;
		this.method = options?.method;
	}
}
