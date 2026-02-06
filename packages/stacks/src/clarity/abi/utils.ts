type CamelCaseInner<S extends string> =
  S extends `${infer P1}-${infer P2}${infer P3}`
    ? `${P1}${Capitalize<CamelCaseInner<`${P2}${P3}`>>}`
    : S;

export type ToCamelCase<S extends string> =
  CamelCaseInner<S> extends `${number}${string}`
    ? `_${CamelCaseInner<S>}`
    : CamelCaseInner<S>;

export function toCamelCase(str: string): string {
  return str
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/-([A-Z])/g, (_, letter) => letter)
    .replace(/-(\d)/g, (_, digit) => digit)
    .replace(/-/g, "")
    .replace(/^\d/, "_$&");
}
