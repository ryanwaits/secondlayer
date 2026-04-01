import { describe, expect, test } from "bun:test";
import { tableToModelName } from "../schema/naming.ts";

describe("tableToModelName", () => {
	test("simple plural", () => {
		expect(tableToModelName("users")).toBe("User");
		expect(tableToModelName("accounts")).toBe("Account");
		expect(tableToModelName("blocks")).toBe("Block");
	});

	test("snake_case → PascalCase", () => {
		expect(tableToModelName("user_profiles")).toBe("UserProfile");
		expect(tableToModelName("api_keys")).toBe("ApiKey");
		expect(tableToModelName("stream_metrics")).toBe("StreamMetric");
		expect(tableToModelName("usage_daily")).toBe("UsageDaily");
		expect(tableToModelName("usage_snapshots")).toBe("UsageSnapshot");
		expect(tableToModelName("magic_links")).toBe("MagicLink");
		expect(tableToModelName("index_progress")).toBe("IndexProgress");
	});

	test("-ies → -y", () => {
		expect(tableToModelName("categories")).toBe("Category");
		expect(tableToModelName("deliveries")).toBe("Delivery");
	});

	test("-ses → -s", () => {
		expect(tableToModelName("statuses")).toBe("Status");
		expect(tableToModelName("addresses")).toBe("Address");
	});

	test("-es edge cases", () => {
		expect(tableToModelName("indices")).toBe("Index");
	});

	test("already singular", () => {
		expect(tableToModelName("staff")).toBe("Staff");
	});

	test("single-word tables", () => {
		expect(tableToModelName("events")).toBe("Event");
		expect(tableToModelName("jobs")).toBe("Job");
		expect(tableToModelName("subgraphs")).toBe("Subgraph");
		expect(tableToModelName("sessions")).toBe("Session");
	});
});
