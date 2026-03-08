import { toCamelCase } from "@secondlayer/stacks/clarity";

export { toCamelCase };

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function toPascalCase(str: string): string {
  return capitalize(toCamelCase(str));
}
