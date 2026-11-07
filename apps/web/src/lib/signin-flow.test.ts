import { describe, expect, test } from "bun:test";
import {
	SIGNIN_START,
	type SigninEvent,
	type SigninState,
	signinReducer,
} from "./signin-flow";

const run = (events: SigninEvent[], from: SigninState = SIGNIN_START) =>
	events.reduce(signinReducer, from);

describe("signinReducer", () => {
	test("typing an email then submitting sends the code, and sent opens the code step", () => {
		const state = run([{ type: "edit", email: "a@b.co" }, { type: "submit" }]);
		expect(state).toEqual({ step: "sending", email: "a@b.co", resend: false });
		expect(signinReducer(state, { type: "sent", devToken: "t" })).toEqual({
			step: "code",
			email: "a@b.co",
			resent: false,
			error: null,
			canResend: true,
			devToken: "t",
		});
	});

	test("submitting an empty email does nothing", () => {
		expect(signinReducer(SIGNIN_START, { type: "submit" })).toBe(SIGNIN_START);
	});

	test("a second submit while sending is ignored", () => {
		const sending = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
		]);
		expect(signinReducer(sending, { type: "submit" })).toBe(sending);
	});

	test("a failed send shows the message and typing clears it", () => {
		const failed = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "send_failed", message: "Too many tries" },
		]);
		expect(failed).toEqual({
			step: "error",
			email: "a@b.co",
			message: "Too many tries",
		});
		expect(signinReducer(failed, { type: "edit", email: "a@b.com" })).toEqual({
			step: "email",
			email: "a@b.com",
			error: null,
		});
	});

	test("a failed send can be tried again with the same email", () => {
		const failed = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "send_failed", message: "x" },
		]);
		expect(signinReducer(failed, { type: "submit" }).step).toBe("sending");
	});

	test("verifying ignores a second verify, and a wrong code returns to the code step with the message", () => {
		const code = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "sent" },
		]);
		const verifying = signinReducer(code, { type: "verify" });
		expect(verifying.step).toBe("verifying");
		expect(signinReducer(verifying, { type: "verify" })).toBe(verifying);
		expect(
			signinReducer(verifying, { type: "verify_failed", message: "Bad code" }),
		).toMatchObject({ step: "code", email: "a@b.co", error: "Bad code" });
	});

	test("a verify that times out is a failure like any other, never a dead end", () => {
		const timedOut = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "sent" },
			{ type: "verify" },
			{ type: "verify_failed", message: "Timed out. Try again." },
		]);
		expect(timedOut).toMatchObject({
			step: "code",
			error: "Timed out. Try again.",
		});
		expect(signinReducer(timedOut, { type: "verify" }).step).toBe("verifying");
	});

	test("resend sends again and says it did", () => {
		const code = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "sent" },
		]);
		const sending = signinReducer(code, { type: "resend" });
		expect(sending).toEqual({ step: "sending", email: "a@b.co", resend: true });
		expect(signinReducer(sending, { type: "sent" })).toMatchObject({
			step: "code",
			resent: true,
			error: null,
		});
	});

	test("a failed resend keeps the code step", () => {
		const failed = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "sent" },
			{ type: "resend" },
			{ type: "send_failed", message: "Slow down" },
		]);
		expect(failed).toMatchObject({
			step: "code",
			error: "Slow down",
			canResend: true,
		});
	});

	test("change email returns to the form with the address still filled in", () => {
		const code = run([
			{ type: "edit", email: "a@b.co" },
			{ type: "submit" },
			{ type: "sent" },
		]);
		expect(signinReducer(code, { type: "change_email" })).toEqual({
			step: "email",
			email: "a@b.co",
			error: null,
		});
	});

	test("the code step opened from ?email= has no resend but still has a way out", () => {
		const entry = signinReducer(SIGNIN_START, {
			type: "enter_code",
			email: "a@b.co",
		});
		expect(entry.step === "code" && entry.canResend).toBe(false);
		expect(signinReducer(entry, { type: "resend" })).toBe(entry);
		expect(signinReducer(entry, { type: "change_email" }).step).toBe("email");
	});

	test("a wrong code on the ?email= entry still has no resend", () => {
		const failed = run(
			[{ type: "verify" }, { type: "verify_failed", message: "Bad code" }],
			signinReducer(SIGNIN_START, { type: "enter_code", email: "a@b.co" }),
		);
		expect(failed).toMatchObject({ step: "code", canResend: false });
	});

	test("?email= does not replace a form the reader already started typing in", () => {
		const typing = signinReducer(SIGNIN_START, {
			type: "edit",
			email: "x@y.z",
		});
		expect(signinReducer(typing, { type: "enter_code", email: "a@b.co" })).toBe(
			typing,
		);
	});

	test("stale answers outside their step are ignored", () => {
		expect(signinReducer(SIGNIN_START, { type: "sent" })).toBe(SIGNIN_START);
		expect(
			signinReducer(SIGNIN_START, { type: "verify_failed", message: "x" }),
		).toBe(SIGNIN_START);
	});
});
