/**
 * Starting a Stripe Checkout as a state machine. `redirecting` ends only by
 * leaving the page, so coming back to it (the browser's back button restores
 * the page from its cache, `pageshow` with `persisted`) must reset it, or the
 * button stays on "Opening checkout..." for good.
 */
export type CheckoutFlow =
	| { step: "editing" }
	| { step: "redirecting" }
	| { step: "failed"; error: string };

export type CheckoutEvent =
	| { type: "start" }
	| { type: "fail"; error: string }
	| { type: "reset" };

export const CHECKOUT_EDITING: CheckoutFlow = { step: "editing" };

export function checkoutReducer(
	flow: CheckoutFlow,
	event: CheckoutEvent,
): CheckoutFlow {
	switch (event.type) {
		case "start":
			// A second tap while the first is opening does nothing.
			return flow.step === "redirecting" ? flow : { step: "redirecting" };
		case "fail":
			return flow.step === "redirecting"
				? { step: "failed", error: event.error }
				: flow;
		case "reset":
			return flow.step === "editing" ? flow : CHECKOUT_EDITING;
	}
}
