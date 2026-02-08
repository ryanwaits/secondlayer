import { BaseError } from "./base.ts";

export class WebSocketError extends BaseError {
  override name = "WebSocketError";

  constructor(message: string, options?: { cause?: Error; details?: string }) {
    super(message, options);
  }
}
