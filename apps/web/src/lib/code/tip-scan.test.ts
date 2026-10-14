import { describe, expect, test } from "bun:test";
import { hasComment, scanLine } from "./tip-scan.mjs";

const table = {
	symbols: {
		ConsumerBatchContext: { kind: "type" as const },
		"sl.streams.events.consume": { kind: "method" as const },
		"sl.streams": { kind: "method" as const },
	},
	endpoints: [
		{ path: "/v1/streams/events" },
		{ path: "/v1/streams/{id}" },
		{ path: "/v1/streams/tip" },
	],
};

const names = (line: string, lang: string) =>
	scanLine(line, lang, table).map((h) => h.name);

describe("source", () => {
	test("a method path is found as a whole, at its offsets", () => {
		const line = "await sl.streams.events.consume({";
		const [hit] = scanLine(line, "typescript", table);
		expect(hit?.kind).toBe("method");
		expect(line.slice(hit?.start, hit?.end)).toBe("sl.streams.events.consume");
	});

	test("the longest known prefix wins", () => {
		expect(names("sl.streams.other()", "ts")).toEqual(["sl.streams"]);
	});

	test("a type is found in a signature", () => {
		const [hit] = scanLine("let a: ConsumerBatchContext;", "ts", table);
		expect(hit).toMatchObject({ name: "ConsumerBatchContext", kind: "type" });
	});

	test("an identifier that is another object's property is not a type", () => {
		expect(names("x.ConsumerBatchContext", "typescript")).toEqual([]);
	});

	test("a comment tail is never scanned", () => {
		expect(names("const a = 1; // ConsumerBatchContext", "ts")).toEqual([]);
		expect(names("// sl.streams.events.consume", "ts")).toEqual([]);
		expect(
			names("/* ConsumerBatchContext */ let x: ConsumerBatchContext;", "ts"),
		).toHaveLength(1);
	});

	test("a word in prose-like trailing text is not a reference", () => {
		expect(names("const a = 1; // raw hex", "ts")).toEqual([]);
	});

	test("a string literal is never scanned", () => {
		expect(names('const x = "sl.streams";', "ts")).toEqual([]);
		expect(names("const x = 'ConsumerBatchContext';", "ts")).toEqual([]);
		expect(names("const x = `sl.streams ${y}`;", "ts")).toEqual([]);
		expect(names('const x = "a \\" sl.streams"; sl.streams', "ts")).toEqual([
			"sl.streams",
		]);
	});

	test("a URL with slashes in a string does not start a comment", () => {
		expect(names('fetch("https://x.dev/a"); sl.streams', "ts")).toEqual([
			"sl.streams",
		]);
	});
});

describe("shell", () => {
	test("an endpoint inside a quoted URL is found", () => {
		const line = 'curl "$URL/v1/streams/events?limit=1"';
		const [hit] = scanLine(line, "bash", table);
		expect(hit).toMatchObject({ name: "/v1/streams/events", kind: "endpoint" });
		expect(line.slice(hit?.start, hit?.end)).toBe("/v1/streams/events");
	});

	test("the literal template beats the parameterized one", () => {
		expect(names("curl $URL/v1/streams/tip", "sh")).toEqual([
			"/v1/streams/tip",
		]);
		expect(names("curl $URL/v1/streams/abc", "sh")).toEqual([
			"/v1/streams/{id}",
		]);
	});

	test("a path the table lacks is plain text", () => {
		expect(names("curl $URL/v1/index/events", "bash")).toEqual([]);
	});

	test("a comment is never scanned, a hash inside a word is not a comment", () => {
		expect(names("# curl $URL/v1/streams/tip", "bash")).toEqual([]);
		expect(names("curl $URL/v1/streams/tip # the tip", "bash")).toHaveLength(1);
		expect(names('curl "$URL/v1/streams/tip#frag"', "bash")).toHaveLength(1);
	});
});

describe("hasComment", () => {
	test("sees own-line and trailing comments, not strings that look like them", () => {
		expect(hasComment("// note", "ts")).toBe(true);
		expect(hasComment("sl.streams(); // note", "typescript")).toBe(true);
		expect(hasComment('fetch("https://x.dev")', "ts")).toBe(false);
		expect(hasComment("curl $URL # note", "bash")).toBe(true);
		expect(hasComment("curl $URL/a#b", "bash")).toBe(false);
		expect(hasComment("// note", "text")).toBe(false);
	});
});

describe("languages", () => {
	test("output and other languages never match", () => {
		for (const lang of ["text", "json", "sql", "toml"])
			expect(names("ConsumerBatchContext /v1/streams/events", lang)).toEqual(
				[],
			);
	});

	test("fence aliases scan like their language", () => {
		expect(names("sl.streams", "js")).toEqual(["sl.streams"]);
		expect(names("curl /v1/streams/tip", "shell")).toEqual(["/v1/streams/tip"]);
	});
});
