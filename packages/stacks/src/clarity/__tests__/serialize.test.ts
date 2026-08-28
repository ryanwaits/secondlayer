import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import { SerializationError } from "../../errors/transaction.ts";
import { BytesReader } from "../../utils/bytes-reader.ts";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import { MAX_CV_DEPTH, deserializeCV } from "../deserialize.ts";
import { serializeCVBytes } from "../serialize.ts";
import { Cl } from "../values.ts";

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);

describe("tuple field order", () => {
	let simnet: Simnet;
	beforeAll(async () => {
		simnet = await initSimnet(MANIFEST);
	});

	test("sorts keys by code unit so mixed-case and underscore keys match the node", () => {
		// localeCompare orders these `a-b`, `a_b`, `a`, `Z`; the node orders
		// `Z`, `a`, `a-b`, `a_b` (byte order: `-` 0x2d < `_` 0x5f, `Z` < `a`).
		// The fixture comes from `to-consensus-buff?` in Clarinet simnet, not
		// from another JS library, since that is the hash a contract checks.
		const ours = bytesToHex(
			serializeCVBytes(
				Cl.tuple({
					a: Cl.uint(1),
					Z: Cl.uint(2),
					"a-b": Cl.uint(4),
					a_b: Cl.uint(5),
				}),
			),
		);
		const onChain = simnet.execute(
			"(to-consensus-buff? { a: u1, Z: u2, a-b: u4, a_b: u5 })",
		).result;
		expect(String(onChain.type)).toBe("some");
		const theirs = (onChain as { value: { value: string } }).value.value;
		expect(ours).toBe(theirs.replace(/^0x/, ""));
		const at = (name: string) =>
			ours.indexOf(`${bytesToHex(new TextEncoder().encode(name))}01`);
		expect(at("Z")).toBeLessThan(at("a"));
		expect(at("a-b")).toBeLessThan(at("a_b"));
	});
});

describe("hostile input", () => {
	test("refuses nesting deeper than the cap with a SerializationError", () => {
		const nested = `${"0a".repeat(10_000)}03`;
		expect(() => deserializeCV(nested)).toThrow(SerializationError);
		expect(() => deserializeCV(nested)).toThrow(/nests deeper/);
	});

	test("accepts nesting up to the cap", () => {
		const atCap = `${"0a".repeat(MAX_CV_DEPTH)}03`;
		expect(() => deserializeCV(atCap)).not.toThrow();
	});

	test("refuses a list whose declared length outruns the bytes", () => {
		// list, 0xffffffff items, one true
		const bytes = hexToBytes("0bffffffff03");
		expect(() => deserializeCV(bytes)).toThrow(SerializationError);
		expect(() => deserializeCV(bytes)).toThrow(/elements/);
	});

	test("refuses a tuple whose declared length outruns the bytes", () => {
		const bytes = hexToBytes("0c0000ffff0161 03".replace(" ", ""));
		expect(() => deserializeCV(bytes)).toThrow(SerializationError);
	});

	test("reads that run past the end raise SerializationError, never NaN", () => {
		expect(() => new BytesReader(new Uint8Array(0)).readUInt8()).toThrow(
			SerializationError,
		);
		expect(() => new BytesReader(new Uint8Array(1)).readUInt16BE()).toThrow(
			SerializationError,
		);
		expect(() => new BytesReader(new Uint8Array(3)).readUInt32BE()).toThrow(
			SerializationError,
		);
		expect(() => deserializeCV("0100")).toThrow(SerializationError);
		expect(() => deserializeCV("")).toThrow(SerializationError);
	});
});

describe("Cl.principal", () => {
	test("rejects a principal with two contract segments instead of dropping one", () => {
		expect(() => Cl.principal("SP000000000000000000002Q6VF78.a.b")).toThrow(
			/Invalid principal/,
		);
	});

	test("rejects an address that does not c32-decode", () => {
		expect(() => Cl.principal("SP1.a")).toThrow(/Invalid principal/);
	});

	test("accepts a standard and a contract principal", () => {
		expect(Cl.principal("SP000000000000000000002Q6VF78").type).toBe("address");
		expect(Cl.principal("SP000000000000000000002Q6VF78.pox-4").type).toBe(
			"contract",
		);
	});
});
