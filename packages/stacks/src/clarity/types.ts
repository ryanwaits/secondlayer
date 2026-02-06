export type ClarityType =
  | "int"
  | "uint"
  | "buffer"
  | "true"
  | "false"
  | "address"
  | "contract"
  | "ok"
  | "err"
  | "none"
  | "some"
  | "list"
  | "tuple"
  | "ascii"
  | "utf8";

/** Wire type IDs matching the Stacks binary format (SIP-005) */
export const ClarityWireType = {
  int: 0x00,
  uint: 0x01,
  buffer: 0x02,
  true: 0x03,
  false: 0x04,
  address: 0x05,
  contract: 0x06,
  ok: 0x07,
  err: 0x08,
  none: 0x09,
  some: 0x0a,
  list: 0x0b,
  tuple: 0x0c,
  ascii: 0x0d,
  utf8: 0x0e,
} as const satisfies Record<ClarityType, number>;

/** Reverse lookup: wire byte → ClarityType string */
const wireTypeToClarity = Object.fromEntries(
  Object.entries(ClarityWireType).map(([k, v]) => [v, k])
) as Record<number, ClarityType>;

export function clarityTypeFromByte(byte: number): ClarityType {
  const type = wireTypeToClarity[byte];
  if (!type) throw new Error(`Unknown clarity wire type: ${byte}`);
  return type;
}

// CV types

export type IntCV = { readonly type: "int"; readonly value: bigint };
export type UIntCV = { readonly type: "uint"; readonly value: bigint };
export type BooleanCV = TrueCV | FalseCV;
export type TrueCV = { readonly type: "true" };
export type FalseCV = { readonly type: "false" };
export type BufferCV = { readonly type: "buffer"; readonly value: string }; // hex
export type NoneCV = { readonly type: "none" };
export type SomeCV = {
  readonly type: "some";
  readonly value: ClarityValue;
};
export type OptionalCV = NoneCV | SomeCV;
export type ResponseOkCV = {
  readonly type: "ok";
  readonly value: ClarityValue;
};
export type ResponseErrorCV = {
  readonly type: "err";
  readonly value: ClarityValue;
};
export type ResponseCV = ResponseOkCV | ResponseErrorCV;
export type StandardPrincipalCV = {
  readonly type: "address";
  readonly value: string;
};
export type ContractPrincipalCV = {
  readonly type: "contract";
  readonly value: string; // "address.name"
};
export type PrincipalCV = StandardPrincipalCV | ContractPrincipalCV;
export type ListCV = {
  type: "list";
  value: ClarityValue[];
};
export type TupleData = {
  [key: string]: ClarityValue;
};
export type TupleCV = {
  type: "tuple";
  value: TupleData;
};
export type StringAsciiCV = {
  readonly type: "ascii";
  readonly value: string;
};
export type StringUtf8CV = {
  readonly type: "utf8";
  readonly value: string;
};

export type ClarityValue =
  | IntCV
  | UIntCV
  | BooleanCV
  | BufferCV
  | NoneCV
  | SomeCV
  | ResponseOkCV
  | ResponseErrorCV
  | StandardPrincipalCV
  | ContractPrincipalCV
  | ListCV
  | TupleCV
  | StringAsciiCV
  | StringUtf8CV;
