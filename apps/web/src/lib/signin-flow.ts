/**
 * The sign-in page as a state machine: ask for an email, send a code, take
 * the code. Every state has a way forward and a way out, and a request in
 * flight (`sending`, `verifying`) ignores a second submit.
 */
export type SigninState =
	| { step: "email"; email: string; error: string | null }
	| { step: "sending"; email: string; resend: boolean }
	| {
			step: "code";
			email: string;
			/** A resend request was just answered. */
			resent: boolean;
			error: string | null;
			/** The code step opened from `?email=` with the code already sent
			 *  elsewhere: there is no resend from here, only a different email. */
			canResend: boolean;
			devToken: string | null;
	  }
	| { step: "verifying"; email: string; canResend: boolean }
	| { step: "error"; email: string; message: string };

export type SigninEvent =
	| { type: "edit"; email: string }
	/** The page opened with `?email=`: the code was sent elsewhere. */
	| { type: "enter_code"; email: string }
	| { type: "submit" }
	| { type: "resend" }
	| { type: "sent"; devToken?: string | null }
	| { type: "send_failed"; message: string }
	| { type: "verify" }
	| { type: "verify_failed"; message: string }
	| { type: "change_email" };

export const SIGNIN_START: SigninState = {
	step: "email",
	email: "",
	error: null,
};

/** The code step the docs panel sends a reader to (`?email=`). */
export function enterCodeStep(email: string): SigninState {
	return {
		step: "code",
		email,
		resent: false,
		error: null,
		canResend: false,
		devToken: null,
	};
}

export const VERIFY_TIMEOUT_MS = 15_000;

export function signinReducer(
	state: SigninState,
	event: SigninEvent,
): SigninState {
	switch (event.type) {
		case "edit":
			return state.step === "email" || state.step === "error"
				? { step: "email", email: event.email, error: null }
				: state;
		case "enter_code":
			return state.step === "email" && state.email === ""
				? enterCodeStep(event.email)
				: state;
		case "submit":
			return (state.step === "email" || state.step === "error") && state.email
				? { step: "sending", email: state.email, resend: false }
				: state;
		case "resend":
			return state.step === "code" && state.canResend
				? { step: "sending", email: state.email, resend: true }
				: state;
		case "sent":
			return state.step === "sending"
				? {
						step: "code",
						email: state.email,
						resent: state.resend,
						error: null,
						canResend: true,
						devToken: event.devToken ?? null,
					}
				: state;
		case "send_failed":
			if (state.step !== "sending") return state;
			// A failed resend keeps the code the reader may still have.
			return state.resend
				? {
						step: "code",
						email: state.email,
						resent: false,
						error: event.message,
						canResend: true,
						devToken: null,
					}
				: { step: "error", email: state.email, message: event.message };
		case "verify":
			return state.step === "code"
				? { step: "verifying", email: state.email, canResend: state.canResend }
				: state;
		case "verify_failed":
			return state.step === "verifying"
				? {
						step: "code",
						email: state.email,
						resent: false,
						error: event.message,
						canResend: state.canResend,
						devToken: null,
					}
				: state;
		case "change_email":
			return state.step === "code" || state.step === "error"
				? { step: "email", email: state.email, error: null }
				: state;
	}
}
