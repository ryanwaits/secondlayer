import { describe, expect, test } from "bun:test";
import {
	determineApiHealth,
	formatLag,
	formatLastChecked,
	readIncidentHeading,
	truncateHash,
} from "./status-page";

describe("status page helpers", () => {
	test("marks tip responses under 60 seconds as OK", () => {
		expect(determineApiHealth({ ok: true, tip: { lag_seconds: 12 } })).toEqual({
			state: "ok",
			label: "OK",
			description: "The API is reachable and ingest lag is under 60 seconds.",
		});
	});

	test("marks tip responses at or above 60 seconds as degraded", () => {
		expect(determineApiHealth({ ok: true, tip: { lag_seconds: 60 } }).state).toBe(
			"degraded",
		);
	});

	test("marks failed tip requests as down", () => {
		expect(determineApiHealth({ ok: false, status: 500 }).state).toBe("down");
	});

	test("formats lag for seconds, minutes, and hours", () => {
		expect(formatLag(4)).toBe("4s");
		expect(formatLag(65)).toBe("1m 5s");
		expect(formatLag(7200)).toBe("2h");
		expect(formatLag(undefined)).toBe("Unknown");
	});

	test("formats last-checked timestamp in UTC", () => {
		expect(formatLastChecked(new Date("2026-05-03T20:30:45.123Z"))).toBe(
			"2026-05-03 20:30:45 UTC",
		);
		expect(formatLastChecked(null)).toBe("Not checked yet");
	});

	test("truncates long block hashes", () => {
		expect(truncateHash("0x1234567890abcdef1234567890abcdef")).toBe(
			"0x12345678...abcdef",
		);
	});

	test("reads the incident heading from markdown", () => {
		expect(readIncidentHeading("## No active incidents\n")).toBe(
			"No active incidents",
		);
	});
});
