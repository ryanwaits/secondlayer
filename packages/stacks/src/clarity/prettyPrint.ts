import { hexToBytes, bytesToAscii, asciiToBytes, utf8ToBytes } from "../utils/encoding.ts";
import type { ClarityValue } from "./types.ts";

export function prettyPrint(val: ClarityValue, encoding: "tryAscii" | "hex" = "hex"): string | undefined {
  switch (val.type) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "int":
      return val.value.toString();
    case "uint":
      return `u${val.value.toString()}`;
    case "buffer":
      if (encoding === "tryAscii") {
        const str = bytesToAscii(hexToBytes(val.value));
        if (/^[ -~]*$/.test(str)) return JSON.stringify(str);
      }
      return `0x${val.value}`;
    case "none":
      return "none";
    case "some":
      return `(some ${prettyPrint(val.value, encoding)})`;
    case "ok":
      return `(ok ${prettyPrint(val.value, encoding)})`;
    case "err":
      return `(err ${prettyPrint(val.value, encoding)})`;
    case "address":
    case "contract":
      return val.value;
    case "list":
      return `(list ${val.value.map((v) => prettyPrint(v, encoding)).join(" ")})`;
    case "tuple":
      return `(tuple ${Object.keys(val.value)
        .map((key) => `(${key} ${prettyPrint(val.value[key]!, encoding)})`)
        .join(" ")})`;
    case "ascii":
      return `"${val.value}"`;
    case "utf8":
      return `u"${val.value}"`;
  }
}

export function cvToJSON(val: ClarityValue): any {
  switch (val.type) {
    case "true":
      return { type: "bool", value: true };
    case "false":
      return { type: "bool", value: false };
    case "int":
      return { type: "int", value: val.value.toString() };
    case "uint":
      return { type: "uint", value: val.value.toString() };
    case "buffer":
      return { type: `(buff ${Math.ceil(val.value.length / 2)})`, value: `0x${val.value}` };
    case "none":
      return { type: "(optional none)", value: null };
    case "some":
      return { type: `(optional)`, value: cvToJSON(val.value) };
    case "ok":
      return { type: "(response)", value: cvToJSON(val.value), success: true };
    case "err":
      return { type: "(response)", value: cvToJSON(val.value), success: false };
    case "address":
    case "contract":
      return { type: "principal", value: val.value };
    case "list":
      return { type: "(list)", value: val.value.map(cvToJSON) };
    case "tuple": {
      const result: Record<string, any> = {};
      for (const key of Object.keys(val.value)) {
        result[key] = cvToJSON(val.value[key]!);
      }
      return { type: "(tuple)", value: result };
    }
    case "ascii":
      return { type: `(string-ascii ${asciiToBytes(val.value).length})`, value: val.value };
    case "utf8":
      return { type: `(string-utf8 ${utf8ToBytes(val.value).length})`, value: val.value };
  }
}

export function cvToValue(val: ClarityValue): any {
  switch (val.type) {
    case "true":
      return true;
    case "false":
      return false;
    case "int":
    case "uint":
      return val.value;
    case "buffer":
      return `0x${val.value}`;
    case "none":
      return null;
    case "some":
      return cvToValue(val.value);
    case "ok":
    case "err":
      return cvToValue(val.value);
    case "address":
    case "contract":
      return val.value;
    case "list":
      return val.value.map(cvToValue);
    case "tuple": {
      const result: Record<string, any> = {};
      for (const key of Object.keys(val.value)) {
        result[key] = cvToValue(val.value[key]!);
      }
      return result;
    }
    case "ascii":
    case "utf8":
      return val.value;
  }
}
