import { BaseError } from "./base.ts";

/** Thrown when a node/API response is missing an expected field. */
export class MalformedResponseError extends BaseError {
	override name = "MalformedResponseError";
}
