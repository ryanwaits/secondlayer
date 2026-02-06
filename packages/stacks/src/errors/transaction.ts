import { BaseError } from "./base.ts";

export class TransactionError extends BaseError {
  override name = "TransactionError";
}

export class BroadcastError extends BaseError {
  override name = "BroadcastError";
  txid?: string;
  reason?: string;

  constructor(
    message: string,
    options?: { cause?: Error; txid?: string; reason?: string }
  ) {
    super(message, options);
    this.txid = options?.txid;
    this.reason = options?.reason;
  }
}

export class SerializationError extends BaseError {
  override name = "SerializationError";
}

export class SigningError extends BaseError {
  override name = "SigningError";
}
