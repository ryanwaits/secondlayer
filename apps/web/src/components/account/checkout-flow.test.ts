import { describe, expect, test } from "bun:test";
import {
	CHECKOUT_EDITING,
	type CheckoutEvent,
	checkoutReducer,
} from "./checkout-flow";

const run = (events: CheckoutEvent[]) =>
	events.reduce(checkoutReducer, CHECKOUT_EDITING);

describe("checkoutReducer", () => {
	test("starting moves to redirecting, and a second start changes nothing", () => {
		const redirecting = run([{ type: "start" }]);
		expect(redirecting).toEqual({ step: "redirecting" });
		expect(checkoutReducer(redirecting, { type: "start" })).toBe(redirecting);
	});

	test("a refused checkout keeps the reason and can be started again", () => {
		const failed = run([
			{ type: "start" },
			{ type: "fail", error: "Couldn't start checkout" },
		]);
		expect(failed).toEqual({
			step: "failed",
			error: "Couldn't start checkout",
		});
		expect(checkoutReducer(failed, { type: "start" })).toEqual({
			step: "redirecting",
		});
	});

	test("coming back to the page resets a checkout that was opening", () => {
		expect(run([{ type: "start" }, { type: "reset" }])).toBe(CHECKOUT_EDITING);
	});

	test("a failure with no checkout opening is ignored", () => {
		expect(run([{ type: "fail", error: "x" }])).toBe(CHECKOUT_EDITING);
	});
});
