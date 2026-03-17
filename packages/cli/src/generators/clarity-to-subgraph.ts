import type { ColumnType } from "@secondlayer/views";
import {
  isAbiBuffer,
  isAbiStringAscii,
  isAbiStringUtf8,
  isAbiOptional,
  type AbiType,
} from "@secondlayer/stacks/clarity";

/**
 * Maps a Clarity ABI type to a ViewColumn ColumnType.
 *
 * Mapping rules:
 *  uint128 / uint  → "uint"
 *  int128 / int    → "int"
 *  principal       → "principal"
 *  bool            → "boolean"
 *  string-ascii N / string-utf8 N / buff N → "text"
 *  (optional T)    → same as T (nullable = true)
 *  everything else → "jsonb"
 */
export interface MappedColumn {
  type: ColumnType;
  nullable: boolean;
}

export function clarityTypeToViewColumn(abiType: AbiType): MappedColumn {
  return mapType(abiType, false);
}

function mapType(abiType: AbiType, nullable: boolean): MappedColumn {
  if (typeof abiType === "string") {
    switch (abiType) {
      case "uint128":
        return { type: "uint", nullable };
      case "int128":
        return { type: "int", nullable };
      case "principal":
      case "trait_reference":
        return { type: "principal", nullable };
      case "bool":
        return { type: "boolean", nullable };
      default: {
        const s = abiType as string;
        if (s.includes("uint")) return { type: "uint", nullable };
        if (s.includes("int")) return { type: "int", nullable };
        if (s.includes("string") || s.includes("ascii") || s.includes("utf8")) {
          return { type: "text", nullable };
        }
        if (s.includes("buff")) return { type: "text", nullable };
        return { type: "jsonb", nullable };
      }
    }
  }

  if (isAbiBuffer(abiType)) return { type: "text", nullable };
  if (isAbiStringAscii(abiType) || isAbiStringUtf8(abiType)) {
    return { type: "text", nullable };
  }
  if (isAbiOptional(abiType)) return mapType(abiType.optional, true);

  // tuple / list / response → jsonb
  return { type: "jsonb", nullable };
}
