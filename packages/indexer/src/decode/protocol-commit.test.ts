import { describe, expect, test } from "bun:test";
import {
	classifyGenericDecodeFault,
	failureFromFaults,
} from "./generic-commit.ts";

describe("protocol decoder coverage", () => {
	test("a reorg-shaped version fault is classified", () => {
		expect(
			classifyGenericDecodeFault(new Error("unknown decoder version")),
		).toBe("version");
		expect(
			failureFromFaults([
				{ cursor: "300:0", class: "version", error: "unknown decoder version" },
			])?.class,
		).toBe("version");
	});
});
