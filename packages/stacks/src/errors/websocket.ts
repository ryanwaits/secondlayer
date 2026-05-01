import { BaseError } from "./base.ts";

export class WebSocketError extends BaseError {
	override name = "WebSocketError";
}
