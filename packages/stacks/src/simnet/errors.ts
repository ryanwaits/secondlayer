import { BaseError } from "../errors/base.ts";

/** The simnet transport does not implement this node/API route. */
export class SimnetUnsupportedError extends BaseError {
	override name = "SimnetUnsupportedError";
	path: string;

	constructor(path: string) {
		super(`simnet transport does not implement ${path}`);
		this.path = path;
	}
}
