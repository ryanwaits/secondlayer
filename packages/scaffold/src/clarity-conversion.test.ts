import { describe, expect, test } from "bun:test";
import { Cl } from "@secondlayer/stacks/clarity";
import { validateStacksAddress } from "@secondlayer/stacks/utils";
import { generateClarityConversion } from "./clarity-conversion.ts";
import { generateContractInterface } from "./contract-interface.ts";

const ADDR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

/**
 * Run the emitted principal conversion the way generated code does: the
 * snippet is an expression over `arg`, closing over the same symbols the
 * generated file imports/inlines. String-matching the template would not have
 * caught either bug this covers.
 */
const transpiler = new Bun.Transpiler({ loader: "ts" });

/** The regex the generated file actually inlines — not the one in
 *  @secondlayer/stacks — so this exercises the grammar users get. */
const INLINED_CONTRACT_NAME_REGEX = (() => {
	const match = /const CONTRACT_NAME_REGEX = (\/.+\/);/.exec(
		generateContractInterface([]),
	);
	if (!match) throw new Error("generated file no longer inlines the regex");
	const [, source] = match as unknown as [string, string];
	return new Function(`return ${source}`)() as RegExp;
})();

function runEmitted(type: "principal" | "trait_reference", arg: string) {
	// The snippet is TypeScript (it carries a cast), so strip types before
	// handing it to Function — generated files go through a TS build too.
	const js = transpiler.transformSync(
		`export default ${generateClarityConversion("arg", { type })}`,
	);
	const fn = new Function(
		"arg",
		"Cl",
		"validateStacksAddress",
		"CONTRACT_NAME_REGEX",
		js.replace(/^\s*export\s+default\s*/, "return "),
	);
	return fn(arg, Cl, validateStacksAddress, INLINED_CONTRACT_NAME_REGEX);
}

describe("generated principal conversion", () => {
	test("converts a standard principal", () => {
		expect(runEmitted("principal", ADDR)).toEqual(Cl.standardPrincipal(ADDR));
	});

	test("converts a contract principal", () => {
		expect(runEmitted("principal", `${ADDR}.token`)).toEqual(
			Cl.contractPrincipal(ADDR, "token"),
		);
	});

	test("accepts underscores in contract names (legal per the Clarity grammar)", () => {
		expect(runEmitted("principal", `${ADDR}.has_underscore`)).toEqual(
			Cl.contractPrincipal(ADDR, "has_underscore"),
		);
	});

	test("throws on a principal with more than one dot segment", () => {
		// Previously truncated to `<addr>.token` and called the wrong contract.
		expect(() => runEmitted("principal", `${ADDR}.token.extra`)).toThrow(
			/Invalid principal format/,
		);
	});

	test("throws on a malformed address", () => {
		expect(() => runEmitted("principal", "not-an-address")).toThrow(
			/Invalid Stacks address format/,
		);
	});

	test("throws on a contract name that breaks the Clarity grammar", () => {
		expect(() => runEmitted("principal", `${ADDR}.9bad`)).toThrow(
			/Invalid contract name format/,
		);
	});

	test("applies the same rules to trait_reference args", () => {
		expect(runEmitted("trait_reference", `${ADDR}.my-trait`)).toEqual(
			Cl.contractPrincipal(ADDR, "my-trait"),
		);
		expect(() => runEmitted("trait_reference", `${ADDR}.a.b`)).toThrow(
			/Invalid principal format/,
		);
	});
});
