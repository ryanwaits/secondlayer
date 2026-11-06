import { describe, expect, test } from "bun:test";
import { isCurrent } from "./dashboard-tabs";

describe("DashboardTabs", () => {
	test("Overview matches only exactly /account", () => {
		expect(isCurrent("/account", "/account")).toBe(true);
		expect(isCurrent("/account/webhooks", "/account")).toBe(false);
	});
});
