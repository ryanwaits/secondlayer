import type { AbiContract } from "./contract.ts";

declare const abiTypes: unique symbol;

/**
 * Phantom type bundle a codegen tool can fuse onto an as-const ABI literal.
 *
 * Function/map keys are camelCase (matching the runtime client's method names)
 * and `args` is the named-args object each method accepts. `ret` is the raw
 * output type before any response unwrapping.
 */
export type ContractTypes = {
	functions: Record<
		string,
		{
			args: object;
			ret: unknown;
			access: "public" | "read-only" | "private";
		}
	>;
	maps?: Record<string, { key: unknown; value: unknown }>;
};

/**
 * An as-const ABI literal branded with named codegen types. The brand is a
 * phantom optional property: it never exists at runtime, so any `TypedAbi`
 * value is still a plain ABI object and works everywhere an `AbiContract`
 * does. Typed consumers (e.g. `getContract`) resolve the brand to surface
 * named type aliases in hovers and errors instead of expanded inline types.
 */
export type TypedAbi<A extends AbiContract, T extends ContractTypes> = A & {
	readonly [abiTypes]?: T;
};

/**
 * Resolve the brand off an ABI type. `never` for un-branded ABIs, which lets
 * consumers fall back to structural inference.
 */
export type AbiTypesOf<C> = C extends {
	readonly [abiTypes]?: infer T;
}
	? NonNullable<T> extends ContractTypes
		? NonNullable<T>
		: never
	: never;
