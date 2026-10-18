import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type PushPrefValues, PushSettingsView } from "./push-settings";

const DEFAULTS: PushPrefValues = {
	webhookFailing: true,
	subgraphStopped: true,
	subgraphNotServing: true,
	replayDone: true,
	spendCap: false,
	keyRepeat: false,
};

const view = (
	state: Parameters<typeof PushSettingsView>[0]["state"],
	extra: Partial<Parameters<typeof PushSettingsView>[0]> = {},
) =>
	renderToStaticMarkup(
		<PushSettingsView
			state={state}
			prefs={DEFAULTS}
			onToggle={() => {}}
			onTurnOn={() => {}}
			onTurnOff={() => {}}
			{...extra}
		/>,
	).replaceAll("&#x27;", "'");

describe("push settings", () => {
	test("off offers Turn on and six switches at their defaults", () => {
		const html = view("off");
		expect(html).toContain("Turn on");
		expect(html.match(/role="switch"/g)).toHaveLength(6);
		expect(html.match(/aria-checked="true"/g)).toHaveLength(4);
		expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
	});
	test("on says so and offers Turn off", () => {
		const html = view("on");
		expect(html).toContain("push on");
		expect(html).toContain("Turn off");
		expect(html).not.toContain("home screen");
	});
	test("blocked and needs_install say what to do", () => {
		expect(view("blocked")).toContain("blocked in settings");
		const html = view("needs_install");
		expect(html).toContain("add to Home Screen first");
		expect(html).toContain(
			"Push needs the app on your home screen. On iPhone: Share, then Add to Home Screen.",
		);
	});
	test("on iOS the hint stays until push is on", () => {
		expect(view("off", { ios: true })).toContain("home screen");
		expect(view("off")).not.toContain("home screen");
	});
	test("unavailable says so and shows no switches", () => {
		const html = view("unavailable");
		expect(html).toContain("Push isn't set up on this server.");
		expect(html).not.toContain('role="switch"');
	});
	test("unsupported says so and shows no switches", () => {
		const html = view("unsupported");
		expect(html).toContain("This browser can't show push.");
		expect(html).not.toContain('role="switch"');
	});
	test("the subgraph toggle describes halting and the error limit", () => {
		expect(view("off")).toContain("It's halted or hits its error limit");
	});
	test("there is no chain toggle and no em dash", () => {
		for (const state of ["off", "on", "needs_install"] as const) {
			const html = view(state, { ios: true });
			expect(html.toLowerCase()).not.toContain("chain");
			expect(html).not.toContain("—");
		}
	});
});
