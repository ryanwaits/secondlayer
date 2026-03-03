export class BaseError extends Error {
  override name = "StacksError";
  shortMessage: string;
  details?: string;

  constructor(shortMessage: string, options?: { cause?: Error; details?: string }) {
    const message = [
      shortMessage,
      options?.details ? `\n${options.details}` : "",
    ].join("");

    super(message, { cause: options?.cause });
    this.shortMessage = shortMessage;
    this.details = options?.details;
  }

  toJSON(): { name: string; message: string; shortMessage: string; details: string | undefined; cause: string | undefined } {
    return {
      name: this.name,
      message: this.message,
      shortMessage: this.shortMessage,
      details: this.details,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}
