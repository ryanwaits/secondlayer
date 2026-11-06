import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { currentTab, mobileHeader, newInsightCount } from "./mobile-shell";

describe("currentTab", () => {
	test("Pulse is only exactly /account", () => {
		expect(currentTab("/account")).toBe("pulse");
	});
	test("a webhook's page keeps Webhooks current", () => {
		expect(currentTab("/account/webhooks/wh_1")).toBe("webhooks");
	});
	test("keys, rows and credits belong to Account", () => {
		expect(currentTab("/account/keys")).toBe("account");
		expect(currentTab("/account/rows")).toBe("account");
		expect(currentTab("/account/credits")).toBe("account");
	});
	test("a prefix must end at a path boundary", () => {
		expect(currentTab("/account/subgraphsx")).toBeNull();
		expect(currentTab("/account/accountx")).toBeNull();
	});
});

describe("mobileHeader", () => {
	test("a webhook detail goes back to Webhooks", () => {
		expect(mobileHeader("/account/webhooks/wh_1")).toEqual({
			kind: "back",
			label: "Webhooks",
			href: "/account/webhooks",
		});
	});
	test("a subgraph detail goes back to Subgraphs", () => {
		expect(mobileHeader("/account/subgraphs/vault")).toEqual({
			kind: "back",
			label: "Subgraphs",
			href: "/account/subgraphs",
		});
	});
	test("Account paths are titled Account", () => {
		expect(mobileHeader("/account/credits")).toEqual({
			kind: "title",
			title: "Account",
		});
	});
	test("/account is titled Pulse", () => {
		expect(mobileHeader("/account")).toEqual({ kind: "title", title: "Pulse" });
	});
});

const insight = (createdAt: string, resolvedAt?: string): Insight =>
	({ id: createdAt, createdAt, resolvedAt }) as Insight;

describe("newInsightCount", () => {
	test("counts only unresolved insights newer than seenAt", () => {
		const seenAt = Date.parse("2026-10-10T00:00:00Z");
		const list = [
			insight("2026-10-11T00:00:00Z"),
			insight("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z"),
			insight("2026-10-09T00:00:00Z"),
		];
		expect(newInsightCount(list, seenAt)).toBe(1);
	});
});
