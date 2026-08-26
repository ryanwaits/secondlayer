import { afterEach, describe, expect, test } from "bun:test";
import {
	defaultInternalIndexApiKey,
	defaultInternalIndexBaseUrl,
	defaultInternalStreamsApiKey,
} from "./index-internal-auth.ts";

const saved = {
	INDEX_INTERNAL_API_KEY: process.env.INDEX_INTERNAL_API_KEY,
	STREAMS_INTERNAL_API_KEY: process.env.STREAMS_INTERNAL_API_KEY,
	SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
	STREAMS_API_URL: process.env.STREAMS_API_URL,
};

function setEnv(key: keyof typeof saved, value: string | undefined) {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

afterEach(() => {
	for (const [key, value] of Object.entries(saved)) {
		setEnv(key as keyof typeof saved, value);
	}
});

describe("internal Index/Streams credentials", () => {
	test("empty STREAMS_INTERNAL_API_KEY falls back to the seeded default", () => {
		setEnv("STREAMS_INTERNAL_API_KEY", "");
		expect(defaultInternalStreamsApiKey()).toBe(
			"sk-sl_streams_decode_internal",
		);
	});

	test("unset STREAMS_INTERNAL_API_KEY falls back to the seeded default", () => {
		setEnv("STREAMS_INTERNAL_API_KEY", undefined);
		expect(defaultInternalStreamsApiKey()).toBe(
			"sk-sl_streams_decode_internal",
		);
	});

	test("set STREAMS_INTERNAL_API_KEY wins", () => {
		setEnv("STREAMS_INTERNAL_API_KEY", "sk-sl_custom");
		expect(defaultInternalStreamsApiKey()).toBe("sk-sl_custom");
	});

	test("empty INDEX_INTERNAL_API_KEY falls back to the seeded default", () => {
		setEnv("INDEX_INTERNAL_API_KEY", "");
		expect(defaultInternalIndexApiKey()).toBe("sk-sl_index_internal");
	});

	test("empty SUBGRAPH_INDEX_API_URL falls through to STREAMS_API_URL", () => {
		setEnv("SUBGRAPH_INDEX_API_URL", "");
		setEnv("STREAMS_API_URL", "http://streams:3800");
		expect(defaultInternalIndexBaseUrl()).toBe("http://streams:3800");
	});

	test("both URLs empty fall through to the in-cluster default", () => {
		setEnv("SUBGRAPH_INDEX_API_URL", "");
		setEnv("STREAMS_API_URL", "");
		expect(defaultInternalIndexBaseUrl()).toBe("http://api:3800");
	});
});
