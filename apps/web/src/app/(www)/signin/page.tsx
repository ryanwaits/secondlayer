"use client";

import { VerifyUnreachableError, useAuth } from "@/lib/auth";
import { codeStepEmail, currentNext, rememberNext } from "@/lib/safe-next";
import { SIGNIN_START, signinReducer } from "@/lib/signin-flow";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useState } from "react";

export default function SignInPage() {
	const { login, verify, account } = useAuth();
	const router = useRouter();
	const [state, dispatch] = useReducer(signinReducer, SIGNIN_START);
	const [code, setCode] = useState("");
	const { email } = state;

	// Already signed in: go where `?next=` asked, else the account page.
	useEffect(() => {
		if (account) router.replace(currentNext());
	}, [account, router]);

	// `?email=`: the code is already on its way, so open on the code step.
	useEffect(() => {
		const sentTo = codeStepEmail(window.location.search);
		if (sentTo) dispatch({ type: "enter_code", email: sentTo });
	}, []);

	const handleInputEsc = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>, clear: () => void) => {
			if (e.key !== "Escape") return;
			if (e.currentTarget.value) {
				clear();
			} else {
				router.push("/");
			}
		},
		[router],
	);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.key === "Escape") router.push("/");
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [router]);

	/** Sends the code (a first send from the form, or a resend from the code
	 *  step) and reports the answer to the machine. */
	const send = useCallback(async () => {
		try {
			rememberNext(currentNext());
			const data = await login(email);
			dispatch({ type: "sent", devToken: data.token ?? null });
		} catch (err) {
			dispatch({
				type: "send_failed",
				message: err instanceof Error ? err.message : "Something went wrong",
			});
		}
	}, [email, login]);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (!email || state.step === "sending") return;
			dispatch({ type: "submit" });
			void send();
		},
		[email, send, state.step],
	);

	const handleResend = useCallback(() => {
		if (state.step !== "code" || !state.canResend) return;
		dispatch({ type: "resend" });
		void send();
	}, [send, state]);

	const handleVerifyCode = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (code.length !== 6 || state.step !== "code") return;
			dispatch({ type: "verify" });
			try {
				await verify(code, email);
				rememberNext("/account");
				window.location.href = currentNext();
			} catch (err) {
				setCode("");
				dispatch({
					type: "verify_failed",
					message:
						err instanceof VerifyUnreachableError
							? err.message
							: "Invalid or expired code. Try again.",
				});
			}
		},
		[code, email, state.step, verify],
	);

	const resending = state.step === "sending" && state.resend;
	const onCodeStep =
		state.step === "code" || state.step === "verifying" || resending;
	const canResend =
		state.step === "code" || state.step === "verifying"
			? state.canResend
			: resending;
	const codeError = state.step === "code" ? state.error : null;
	const devToken = state.step === "code" ? state.devToken : null;

	return (
		<div className="login-page">
			<div className="login-card">
				{onCodeStep ? (
					<div className="login-sent">
						<p className="login-sent-title">Check your email</p>
						<p className="login-sent-desc">
							{state.step === "code" && state.resent
								? "We sent a new sign-in code to "
								: "We sent a sign-in code to "}
							<strong>{email}</strong>
						</p>
						<form onSubmit={handleVerifyCode}>
							<input
								type="text"
								inputMode="numeric"
								pattern="[0-9]*"
								maxLength={6}
								className="login-input"
								placeholder="000000"
								value={code}
								onChange={(e) =>
									setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
								}
								onKeyDown={(e) => handleInputEsc(e, () => setCode(""))}
								autoFocus
								style={{
									textAlign: "center",
									letterSpacing: "0.5em",
									fontSize: 20,
								}}
							/>
							{codeError && <p className="login-error">{codeError}</p>}
							<button
								type="submit"
								className="login-submit"
								disabled={code.length !== 6 || state.step === "verifying"}
							>
								{state.step === "verifying" ? "Verifying..." : "Verify"}
							</button>
						</form>
						<div className="login-links">
							{canResend ? (
								<button
									type="button"
									className="login-link"
									disabled={state.step !== "code"}
									onClick={handleResend}
								>
									{resending ? "Sending..." : "Send a new code"}
								</button>
							) : null}
							<button
								type="button"
								className="login-link"
								disabled={state.step !== "code"}
								onClick={() => {
									setCode("");
									dispatch({ type: "change_email" });
								}}
							>
								Use a different email
							</button>
						</div>
						<p className="login-disclaimer" style={{ marginTop: 16 }}>
							Or click the link in your email to sign in directly.
						</p>
						{devToken && (
							<a
								href={`/auth/verify?token=${devToken}`}
								className="login-dev-link"
							>
								[DEV] Click to verify →
							</a>
						)}
					</div>
				) : (
					<form onSubmit={handleSubmit}>
						<span className="login-eyebrow">Account</span>
						<h1 className="login-title">Sign in</h1>
						<label className="login-label" htmlFor="email">
							Email
						</label>
						<input
							id="email"
							type="email"
							className="login-input"
							placeholder="name@domain.com"
							value={email}
							onChange={(e) =>
								dispatch({ type: "edit", email: e.target.value })
							}
							onKeyDown={(e) =>
								handleInputEsc(e, () => dispatch({ type: "edit", email: "" }))
							}
							required
							autoFocus
						/>
						{state.step === "error" && (
							<p className="login-error">{state.message}</p>
						)}
						<button
							type="submit"
							className="login-submit"
							disabled={state.step === "sending"}
						>
							{state.step === "sending" ? "Sending..." : "Send me a login code"}
						</button>
						<p className="login-disclaimer">
							New here? Entering your email creates your account.
						</p>
					</form>
				)}
			</div>
		</div>
	);
}
