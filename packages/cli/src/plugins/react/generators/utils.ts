/**
 * Utility functions for React hook generation
 */

import type { FunctionArg } from "@secondlayer/stacks/clarity";
import { capitalize, toCamelCase } from "../../../utils/case-conversion";
import { clarityTypeToTS } from "../../../utils/type-mapping";

// Re-export for use in other files
export { toCamelCase, clarityTypeToTS, capitalize };

export function generateHookArgsSignature(
	args: ReadonlyArray<FunctionArg>,
): string {
	if (args.length === 0) return "";

	const argsList = args
		.map((arg) => `${toCamelCase(arg.name)}: ${clarityTypeToTS(arg.type)}`)
		.join(", ");
	return `${argsList}`;
}

export function generateArgsType(args: ReadonlyArray<FunctionArg>): string {
	if (args.length === 0) return "void";

	const argsList = args
		.map((arg) => `${toCamelCase(arg.name)}: ${clarityTypeToTS(arg.type)}`)
		.join("; ");
	return `{ ${argsList} }`;
}

export function generateArgNames(args: ReadonlyArray<FunctionArg>): string {
	if (args.length === 0) return "";
	return args.map((arg) => toCamelCase(arg.name)).join(", ");
}

export function generateEnabledCondition(
	args: ReadonlyArray<FunctionArg>,
): string {
	return args
		.map((arg) => {
			const camelName = toCamelCase(arg.name);
			const type = clarityTypeToTS(arg.type);
			if (type === "string") return `!!${camelName}`;
			if (type === "bigint") return `${camelName} !== undefined`;
			return `${camelName} !== undefined`;
		})
		.join(" && ");
}

export function generateObjectArgs(args: ReadonlyArray<FunctionArg>): string {
	if (args.length === 0) return "";
	return args.map((arg) => `${arg.name}: ${toCamelCase(arg.name)}`).join(", ");
}
