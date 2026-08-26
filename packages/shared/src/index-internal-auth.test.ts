import { afterEach, describe, expect, test } from "bun:test";
import {
	defaultInternalIndexApiKey,
	defaultInternalIndexBaseUrl,
	defaultInternalStreamsApiKey,
	requireInternalStreamsApiKey,
} from "./index-internal-auth.ts";

const saved = {
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
	test("STREAMS_INTERNAL_API_KEY wins over INSTANCE_TOKEN", () => {
		expect(
			defaultInternalStreamsApiKey({
				STREAMS_INTERNAL_API_KEY: "sl-int_custom",
				INSTANCE_TOKEN: "instance",
			}),
		).toBe("sl-int_custom");
	});

	test("empty STREAMS_INTERNAL_API_KEY falls through to INSTANCE_TOKEN", () => {
		expect(
			defaultInternalStreamsApiKey({
				STREAMS_INTERNAL_API_KEY: "",
				INSTANCE_TOKEN: "instance-token",
			}),
		).toBe("instance-token");
	});

	test("both empty → undefined", () => {
		expect(
			defaultInternalStreamsApiKey({
				STREAMS_INTERNAL_API_KEY: "",
				INSTANCE_TOKEN: "",
			}),
		).toBeUndefined();
		expect(defaultInternalStreamsApiKey({})).toBeUndefined();
	});

	test("INDEX_INTERNAL_API_KEY wins over INSTANCE_TOKEN", () => {
		expect(
			defaultInternalIndexApiKey({
				INDEX_INTERNAL_API_KEY: "sl-int_index",
				INSTANCE_TOKEN: "instance",
			}),
		).toBe("sl-int_index");
	});

	test("empty INDEX_INTERNAL_API_KEY falls through to INSTANCE_TOKEN", () => {
		expect(
			defaultInternalIndexApiKey({
				INDEX_INTERNAL_API_KEY: "  ",
				INSTANCE_TOKEN: "instance-token",
			}),
		).toBe("instance-token");
	});

	test("both Index env empty → undefined", () => {
		expect(
			defaultInternalIndexApiKey({
				INDEX_INTERNAL_API_KEY: "",
				INSTANCE_TOKEN: "",
			}),
		).toBeUndefined();
	});

	test("requireInternalStreamsApiKey throws when both empty", () => {
		expect(() => requireInternalStreamsApiKey({})).toThrow(
			/STREAMS_INTERNAL_API_KEY.*INSTANCE_TOKEN/,
		);
	});

	test("requireInternalStreamsApiKey returns INSTANCE_TOKEN when internal env is empty", () => {
		expect(
			requireInternalStreamsApiKey({
				STREAMS_INTERNAL_API_KEY: "",
				INSTANCE_TOKEN: "instance-token",
			}),
		).toBe("instance-token");
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
