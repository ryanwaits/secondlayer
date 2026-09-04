import { BaseError } from "./base.ts";

/** Thrown when a node/API response is missing an expected field. */
export class MalformedResponseError extends BaseError {
	override name = "MalformedResponseError";
}

/** Thrown when `/v2/contracts/call-read` answers `okay: false`. */
export class ReadContractError extends BaseError {
	override name = "ReadContractError";
}
