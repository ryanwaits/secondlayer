import { BaseError } from "./base.ts";

export class ContractCallError extends BaseError {
  override name = "ContractCallError";
}

export class ReadOnlyCallError extends BaseError {
  override name = "ReadOnlyCallError";
}
