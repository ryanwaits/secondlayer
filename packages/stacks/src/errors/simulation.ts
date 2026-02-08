import { BaseError } from "./base.ts";

export class SimulationError extends BaseError {
  override name = "SimulationError";
  writesDetected: boolean;

  constructor(
    message: string,
    options: { writesDetected: boolean; details?: string }
  ) {
    super(message, { details: options.details });
    this.writesDetected = options.writesDetected;
  }
}
