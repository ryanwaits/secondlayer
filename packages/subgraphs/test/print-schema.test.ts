import { expect, test } from "bun:test";
import {
	Cl,
	type ClarityValue,
	serializeCV,
} from "@secondlayer/stacks/clarity";
import {
	type PrintSample,
	camelizeDataKey,
	inferPrintTopics,
} from "../src/print-schema.ts";
import { validateSubgraphDefinition } from "../src/validate.ts";

const ADDR = "SP000000000000000000002Q6VF78";

function sample(
	topic: string,
	cv: ClarityValue,
	blockHeight = 100,
): PrintSample {
	return { blockHeight, topic, rawHex: serializeCV(cv) };
}

function tupleSample(
	topic: string,
	data: Record<string, ClarityValue>,
	blockHeight = 100,
): PrintSample {
	return sample(
		topic,
		Cl.tuple({ topic: Cl.stringAscii(topic), ...data }),
		blockHeight,
	);
}

function fieldsOf(samples: PrintSample[], topic: string) {
	const t = inferPrintTopics(samples).find((x) => x.topic === topic);
	if (!t) throw new Error(`topic ${topic} not inferred`);
	return t;
}

test("camelizeDataKey matches runner camelization", () => {
	expect(camelizeDataKey("bitcoin-txid")).toBe("bitcoinTxid");
	expect(camelizeDataKey("pox-4-cycle")).toBe("pox4Cycle");
	expect(camelizeDataKey("amount")).toBe("amount");
});

test("none + some(uint) unifies to (optional uint)", () => {
	const topic = fieldsOf(
		[
			tupleSample("deposit", { memo: Cl.none() }),
			tupleSample("deposit", { memo: Cl.some(Cl.uint(7)) }),
		],
		"deposit",
	);
	const memo = topic.fields.find((f) => f.name === "memo");
	expect(memo?.clarity_type).toBe("(optional uint)");
	expect(memo?.ts_type).toBe("bigint | null");
	expect(memo?.column_type).toBe("uint");
	expect(memo?.always_present).toBe(true);
	expect(memo?.optional_some_rate).toBe(0.5);
});

test("none-only field renders (optional ?) with unknown ts type", () => {
	const topic = fieldsOf([tupleSample("t", { memo: Cl.none() })], "t");
	const memo = topic.fields.find((f) => f.name === "memo");
	expect(memo?.clarity_type).toBe("(optional ?)");
	expect(memo?.ts_type).toBe("unknown | null");
	expect(memo?.column_type).toBe("jsonb");
});

test("field missing in some samples → always_present false, no some rate", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { amount: Cl.uint(1) }),
			tupleSample("t", { amount: Cl.uint(2), fee: Cl.uint(3) }),
		],
		"t",
	);
	const fee = topic.fields.find((f) => f.name === "fee");
	expect(fee?.always_present).toBe(false);
	expect(fee?.optional_some_rate).toBeUndefined();
	expect(topic.fields.find((f) => f.name === "amount")?.always_present).toBe(
		true,
	);
});

test("true + false unify to bool", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { flag: Cl.bool(true) }),
			tupleSample("t", { flag: Cl.bool(false) }),
		],
		"t",
	);
	const flag = topic.fields.find((f) => f.name === "flag");
	expect(flag?.clarity_type).toBe("bool");
	expect(flag?.ts_type).toBe("boolean");
	expect(flag?.column_type).toBe("boolean");
});

test("standard + contract principal unify to principal", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { who: Cl.standardPrincipal(ADDR) }),
			tupleSample("t", { who: Cl.contractPrincipal(ADDR, "pox") }),
		],
		"t",
	);
	const who = topic.fields.find((f) => f.name === "who");
	expect(who?.clarity_type).toBe("principal");
	expect(who?.ts_type).toBe("string");
	expect(who?.column_type).toBe("principal");
});

test("buff length is the max observed", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { "bitcoin-txid": Cl.bufferFromHex("aa") }),
			tupleSample("t", { "bitcoin-txid": Cl.bufferFromHex("00".repeat(32)) }),
		],
		"t",
	);
	const txid = topic.fields.find((f) => f.name === "bitcoin-txid");
	expect(txid?.clarity_type).toBe("(buff 32)");
	expect(txid?.camel_name).toBe("bitcoinTxid");
	expect(txid?.ts_type).toBe("string");
	expect(txid?.column_type).toBe("text");
});

test("string-ascii length is the max observed", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { name: Cl.stringAscii("ab") }),
			tupleSample("t", { name: Cl.stringAscii("hello world") }),
		],
		"t",
	);
	expect(topic.fields.find((f) => f.name === "name")?.clarity_type).toBe(
		"(string-ascii 11)",
	);
});

test("nested tuple recursion with sometimes-missing subfield", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { info: Cl.tuple({ "x-val": Cl.uint(1) }) }),
			tupleSample("t", {
				info: Cl.tuple({ "x-val": Cl.uint(2), done: Cl.bool(true) }),
			}),
		],
		"t",
	);
	const info = topic.fields.find((f) => f.name === "info");
	expect(info?.clarity_type).toBe(
		"(tuple (x-val uint) (done (optional bool)))",
	);
	expect(info?.ts_type).toBe("{ xVal: bigint; done?: boolean }");
	expect(info?.column_type).toBe("jsonb");
});

test("non-tuple prints yield non_tuple topic with empty fields", () => {
	const topics = inferPrintTopics([
		sample("*", Cl.uint(42)),
		sample("*", Cl.stringAscii("hi")),
	]);
	expect(topics).toHaveLength(1);
	expect(topics[0]?.non_tuple).toBe(true);
	expect(topics[0]?.fields).toEqual([]);
});

test("irreconcilable scalars render a union and fall back to jsonb", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { v: Cl.uint(1) }),
			tupleSample("t", { v: Cl.stringAscii("hello") }),
		],
		"t",
	);
	const v = topic.fields.find((f) => f.name === "v");
	expect(v?.clarity_type).toBe("uint | (string-ascii 5)");
	expect(v?.ts_type).toBe("bigint | string");
	expect(v?.column_type).toBe("jsonb");
});

test("response unifies both sides; column type follows the ok side", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { result: Cl.ok(Cl.uint(1)) }),
			tupleSample("t", { result: Cl.error(Cl.stringAscii("bad")) }),
		],
		"t",
	);
	const result = topic.fields.find((f) => f.name === "result");
	expect(result?.clarity_type).toBe("(response uint (string-ascii 3))");
	expect(result?.ts_type).toBe("bigint | string");
	expect(result?.column_type).toBe("uint");
});

test("list element types unify; empty-only list renders (list ?)", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { items: Cl.list([Cl.uint(1), Cl.uint(2)]) }),
			tupleSample("t", { empty: Cl.list([]), items: Cl.list([Cl.uint(3)]) }),
		],
		"t",
	);
	expect(topic.fields.find((f) => f.name === "items")?.clarity_type).toBe(
		"(list uint)",
	);
	expect(topic.fields.find((f) => f.name === "items")?.ts_type).toBe(
		"bigint[]",
	);
	expect(topic.fields.find((f) => f.name === "empty")?.clarity_type).toBe(
		"(list ?)",
	);
});

test("optional_some_rate is the share of present samples that were some", () => {
	const topic = fieldsOf(
		[
			tupleSample("t", { memo: Cl.none() }),
			tupleSample("t", { memo: Cl.some(Cl.uint(1)) }),
			tupleSample("t", { memo: Cl.some(Cl.uint(2)) }),
			tupleSample("t", { memo: Cl.some(Cl.uint(3)) }),
		],
		"t",
	);
	expect(topic.fields.find((f) => f.name === "memo")?.optional_some_rate).toBe(
		0.75,
	);
});

test("topics sorted by count desc with per-topic height bounds", () => {
	const topics = inferPrintTopics([
		tupleSample("rare", { a: Cl.uint(1) }, 50),
		tupleSample("common", { a: Cl.uint(1) }, 10),
		tupleSample("common", { a: Cl.uint(2) }, 99),
		tupleSample("common", { a: Cl.uint(3) }, 42),
	]);
	expect(topics.map((t) => t.topic)).toEqual(["common", "rare"]);
	expect(topics[0]?.count).toBe(3);
	expect(topics[0]?.first_height).toBe(10);
	expect(topics[0]?.last_height).toBe(99);
});

test("null or undecodable hex counts toward totals but not typing", () => {
	const topics = inferPrintTopics([
		tupleSample("t", { a: Cl.uint(1) }, 5),
		{ blockHeight: 6, topic: "t", rawHex: null },
		{ blockHeight: 7, topic: "t", rawHex: "0xzznotclarity" },
	]);
	expect(topics[0]?.count).toBe(3);
	expect(topics[0]?.first_height).toBe(5);
	expect(topics[0]?.last_height).toBe(7);
	expect(topics[0]?.non_tuple).toBe(false);
	expect(topics[0]?.fields.map((f) => f.name)).toEqual(["a"]);
});

test("null-hex rows do not consume the per-topic decode budget", () => {
	const samples: PrintSample[] = [];
	// 120 null-hex rows at the newest heights: if these consumed budget slots,
	// the newest hex rows (the only ones carrying "fee") would never decode.
	for (let h = 2000; h < 2120; h++) {
		samples.push({ blockHeight: h, topic: "t", rawHex: null });
	}
	// 120 hex rows (over the 100 budget); "fee" only on the newest 10 of them
	for (let h = 100; h < 220; h++) {
		const data: Record<string, ClarityValue> = { amount: Cl.uint(h) };
		if (h >= 210) data.fee = Cl.uint(1);
		samples.push(tupleSample("t", data, h));
	}
	const topic = fieldsOf(samples, "t");
	expect(topic.count).toBe(240);
	expect(topic.first_height).toBe(100);
	expect(topic.last_height).toBe(2119);
	expect(topic.fields.map((f) => f.name)).toEqual(["amount", "fee"]);
	expect(topic.fields.find((f) => f.name === "fee")?.always_present).toBe(
		false,
	);
});

test("zero decoded samples → non_tuple false with empty fields", () => {
	const topics = inferPrintTopics([
		{ blockHeight: 1, topic: "named", rawHex: null },
		{ blockHeight: 2, topic: "named", rawHex: "0xzznotclarity" },
	]);
	expect(topics).toHaveLength(1);
	expect(topics[0]?.non_tuple).toBe(false);
	expect(topics[0]?.fields).toEqual([]);
	expect(topics[0]?.count).toBe(2);
});

test("unification is independent of sample order (optional + conflict)", () => {
	const fwd = [
		tupleSample("t", { v: Cl.uint(1) }, 1),
		tupleSample("t", { v: Cl.stringAscii("hello") }, 2),
		tupleSample("t", { v: Cl.none() }, 3),
	];
	const a = inferPrintTopics(fwd);
	const b = inferPrintTopics([...fwd].reverse());
	expect(b).toEqual(a);
	const v = a[0]?.fields.find((f) => f.name === "v");
	expect(v?.clarity_type).toBe("(optional uint | (string-ascii 5))");
	expect(v?.ts_type).toBe("bigint | string | null");
	expect(v?.column_type).toBe("jsonb");
});

test("topic discriminant is excluded from fields", () => {
	const topic = fieldsOf([tupleSample("t", { a: Cl.uint(1) })], "t");
	expect(topic.fields.map((f) => f.name)).toEqual(["a"]);
});

test("validateSubgraphDefinition accepts print_event prints map", () => {
	const def = {
		name: "prints-test",
		sources: {
			deposits: {
				type: "print_event",
				contractId: `${ADDR}.sbtc-registry`,
				topic: "completed-deposit",
				prints: {
					"completed-deposit": { amount: "uint", bitcoinTxid: "text" },
				},
			},
		},
		schema: { data: { columns: { amount: { type: "uint" } } } },
		handlers: { deposits: () => {} },
	};
	const result = validateSubgraphDefinition(def);
	expect(result.name).toBe("prints-test");
	expect(() =>
		validateSubgraphDefinition({
			...def,
			sources: {
				deposits: {
					...def.sources.deposits,
					prints: { "completed-deposit": { amount: "not-a-column-type" } },
				},
			},
		}),
	).toThrow();
});
