"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
	const { login, verify } = useAuth();
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
		"idle",
	);
	const [devToken, setDevToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [verifyError, setVerifyError] = useState<string | null>(null);

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
			if (e.key === "s" || e.key === "S" || e.key === "Escape") {
				router.push("/");
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [router]);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!email || status === "sending") return;
			setStatus("sending");
			setError(null);
			try {
				const data = await login(email);
				if (data.token) setDevToken(data.token);
				setStatus("sent");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
				setStatus("error");
			}
		},
		[email, login, status],
	);

	const handleVerifyCode = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (code.length !== 6) return;
			setVerifyError(null);
			try {
				await verify(code, email);
				router.replace("/");
			} catch {
				setVerifyError("Invalid or expired code. Try again.");
			}
		},
		[code, email, verify, router],
	);

	return (
		<div className="login-page">
			<Link href="/" className="login-back">
				<span className="auth-bar-nav-key">[S]</span>
				<span className="auth-bar-nav-label">Secondlayer</span>
			</Link>
			<div className="login-card">
				{status === "sent" ? (
					<div className="login-sent">
						<p className="login-sent-title">Check your email</p>
						<p className="login-sent-desc">
							We sent a login code to <strong>{email}</strong>
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
							{verifyError && <p className="login-error">{verifyError}</p>}
							<button
								type="submit"
								className="login-submit"
								disabled={code.length !== 6}
							>
								Verify
							</button>
						</form>
						<p className="login-disclaimer" style={{ marginTop: 16 }}>
							Or click the link in your email to sign in directly. Didn&apos;t
							get it? You may need{" "}
							<Link href="/#early-access">early access</Link> first.
						</p>
						{devToken && (
							<a href={`/verify?token=${devToken}`} className="login-dev-link">
								[DEV] Click to verify →
							</a>
						)}
					</div>
				) : (
					<form onSubmit={handleSubmit}>
						<label className="login-label" htmlFor="email">
							Email
						</label>
						<input
							id="email"
							type="email"
							className="login-input"
							placeholder="name@domain.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => handleInputEsc(e, () => setEmail(""))}
							required
							autoFocus
						/>
						{error && <p className="login-error">{error}</p>}
						<button
							type="submit"
							className="login-submit"
							disabled={status === "sending"}
						>
							{status === "sending" ? "Sending..." : "Send me a login code"}
						</button>
						<p className="login-disclaimer">
							You&apos;ll receive a code if you have an account or approved
							early access. Otherwise,{" "}
							<Link href="/#early-access">join the early access list</Link>.
						</p>
					</form>
				)}
			</div>
		</div>
	);
}
