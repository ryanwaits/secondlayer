export type SigninState =
	| { step: "email"; email: string; error: string | null }
	| { step: "sending"; email: string; resend: boolean }
	| {
			step: "code";
			email: string;
			resent: boolean;
			error: string | null;
			canResend: boolean;
			devToken: string | null;
	  }
	| { step: "verifying"; email: string; canResend: boolean }
	| { step: "error"; email: string; message: string };

export type SigninEvent =
	| { type: "edit"; email: string }
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
