/**
 * Shared code-generation utility for converting TypeScript values to ClarityValue expressions.
 * Used by contract, actions, and testing generators.
 */

import { toCamelCase } from "@secondlayer/clarity-types";

/**
 * Generate a code string that converts a TypeScript value to a ClarityValue
 * based on the Clarity ABI argument type.
 */
export function generateClarityConversion(
  argName: string,
  argType: any
): string {
  const type = argType.type;

  if (typeof type === "string") {
    switch (type) {
      case "uint128":
        return `Cl.uint(${argName})`;
      case "int128":
        return `Cl.int(${argName})`;
      case "bool":
        return `Cl.bool(${argName})`;
      case "principal":
      case "trait_reference":
        return `(() => {
          const [address, contractName] = ${argName}.split(".") as [string, string | undefined];
          if (!validateStacksAddress(address)) {
            throw new Error("Invalid Stacks address format");
          }
          if (contractName !== undefined) {
            if (!CONTRACT_NAME_REGEX.test(contractName)) {
              throw new Error("Invalid contract name format: must start with letter and contain only letters, numbers, and hyphens");
            }
            return Cl.contractPrincipal(address, contractName);
          }
          return Cl.standardPrincipal(${argName});
        })()`;
      default:
        return `${argName}`;
    }
  }

  if (type["string-ascii"]) {
    return `Cl.stringAscii(${argName})`;
  }

  if (type["string-utf8"]) {
    return `Cl.stringUtf8(${argName})`;
  }

  if (type.buff) {
    return `(() => {
      const value = ${argName};
      if (value instanceof Uint8Array) {
        return Cl.buffer(value);
      }
      if (typeof value === 'object' && value !== null && value.type && value.value) {
        switch (value.type) {
          case 'ascii':
            return Cl.bufferFromAscii(value.value);
          case 'utf8':
            return Cl.bufferFromUtf8(value.value);
          case 'hex':
            return Cl.bufferFromHex(value.value);
          default:
            throw new Error(\`Unsupported buffer type: \${value.type}\`);
        }
      }
      if (typeof value === 'string') {
        if (value.startsWith('0x') || /^[0-9a-fA-F]+$/.test(value)) {
          return Cl.bufferFromHex(value);
        }
        const hasNonAscii = value.split('').some(char => char.charCodeAt(0) > 127);
        if (hasNonAscii) {
          return Cl.bufferFromUtf8(value);
        }
        return Cl.bufferFromAscii(value);
      }
      throw new Error(\`Invalid buffer value: \${value}\`);
    })()`;
  }

  if (type.optional) {
    const innerConversion = generateClarityConversion(argName, {
      type: type.optional,
    });
    return `${argName} !== null ? Cl.some(${innerConversion.replace(argName, `${argName}`)}) : Cl.none()`;
  }

  if (type.list) {
    const innerConversion = generateClarityConversion("item", {
      type: type.list.type,
    });
    const maxLength = type.list.length || 100;
    return `(() => {
      const listValue = ${argName};
      if (listValue.length > ${maxLength}) {
        throw new Error(\`List length \${listValue.length} exceeds max ${maxLength}\`);
      }
      return Cl.list(listValue.map(item => ${innerConversion}));
    })()`;
  }

  if (type.tuple) {
    const requiredFields = type.tuple.map((f: any) => f.name);
    const fieldNames = JSON.stringify(requiredFields);
    const fields = type.tuple
      .map((field: any) => {
        const camelFieldName = toCamelCase(field.name);
        const fieldConversion = generateClarityConversion(
          `tupleValue.${camelFieldName}`,
          { type: field.type }
        );
        return `"${field.name}": ${fieldConversion}`;
      })
      .join(", ");
    return `(() => {
      const tupleValue = ${argName};
      const requiredFields = ${fieldNames};
      for (const fieldName of requiredFields) {
        const camelName = fieldName.replace(/-([a-z])/g, (_: string, l: string) => l.toUpperCase());
        if (!(fieldName in tupleValue) && !(camelName in tupleValue)) {
          throw new Error(\`Missing tuple field: \${fieldName}\`);
        }
      }
      return Cl.tuple({ ${fields} });
    })()`;
  }

  if (type.response) {
    const okConversion = generateClarityConversion(`responseValue.ok`, {
      type: type.response.ok,
    });
    const errConversion = generateClarityConversion(`responseValue.err`, {
      type: type.response.error,
    });
    return `(() => {
      const responseValue = ${argName};
      const hasOk = 'ok' in responseValue;
      const hasErr = 'err' in responseValue;
      if (hasOk && !hasErr) {
        return Cl.ok(${okConversion});
      }
      if (hasErr && !hasOk) {
        return Cl.error(${errConversion});
      }
      throw new Error("Response must have exactly 'ok' or 'err' property");
    })()`;
  }

  return `${argName}`;
}
