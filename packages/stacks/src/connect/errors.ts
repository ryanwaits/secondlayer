import { BaseError } from "../errors/base.ts";

export class ConnectError extends BaseError {
  override name = "ConnectError";
}

export enum JsonRpcErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  UserRejection = -31001,
}

export class JsonRpcError extends ConnectError {
  override name = "JsonRpcError";
  code: number;
  data?: string;

  constructor(
    message: string,
    code: number,
    options?: { data?: string; cause?: Error }
  ) {
    super(message, { cause: options?.cause, details: options?.data });
    this.code = code;
    this.data = options?.data;
  }
}
