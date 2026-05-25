"use client";

import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CopyButton } from "./copy-button";

type Step = "email" | "code" | "create" | "reveal";

/** Products that can mint a scoped key inline. */
export type KeyProduct = "streams" | "index";

const PRODUCT_LABEL: Record<KeyProduct, string> = {
	streams: "Streams",
	index: "Index",
};

function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : "Something went wrong — try again.";
}

/**
 * Inline create-account / sign-in / create-key flow.
 * Magic-link email → 6-digit code (or one-click when already signed in) →
 * reveal-once key. No full-page redirect.
 *
 * `context` tunes the copy: "sandbox" assumes the key is filled into a
 * surrounding playground; "inline" is for standalone prose (docs/product
 * pages) where the user just copies the revealed key.
 *
 * Rendered inside the sandbox's <form>, so this uses plain elements + Enter
 * handling rather than nested <form>s (which are invalid and would trigger
 * the sandbox's own submit).
 */
export function InlineKeyCreate({
	onKey,
	onCancel,
	product = "streams",
	context = "sandbox",
}: {
	onKey: (key: string) => void;
	onCancel: () => void;
	product?: KeyProduct;
	context?: "sandbox" | "inline";
}) {
	const { account, login, verify } = useAuth();
	const [step, setStep] = useState<Step>(account ? "create" : "email");
	const [email, setEmail] = useState(account?.email ?? "");
	const [code, setCode] = useState("");
	const [revealed, setRevealed] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const productLabel = PRODUCT_LABEL[product];
	const codeHintId = useId();

	const createStreamsKey = useCallback(async (): Promise<string> => {
		const res = await fetch("/api/keys", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: context === "sandbox" ? "Playground" : productLabel,
				product,
			}),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(data.error || "Couldn't create a key.");
		}
		const data = (await res.json()) as { key: string };
		return data.key;
	}, [product, productLabel, context]);

	const finish = useCallback(
		(key: string) => {
			setRevealed(key);
			setStep("reveal");
			onKey(key); // fill + persist into the sandbox immediately
		},
		[onKey],
	);

	const run = useCallback(async (fn: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(errMessage(err));
		} finally {
			setBusy(false);
		}
	}, []);

	const submitEmail = useCallback(
		() =>
			run(async () => {
				await login(email.trim());
				setStep("code");
			}),
		[run, login, email],
	);

	const submitCode = useCallback(
		() =>
			run(async () => {
				const { apiKey } = await verify(code.trim(), email.trim());
				finish(apiKey ?? (await createStreamsKey()));
			}),
		[run, verify, code, email, finish, createStreamsKey],
	);

	const submitCreate = useCallback(
		() => run(async () => finish(await createStreamsKey())),
		[run, finish, createStreamsKey],
	);

	// Signed-in users clicked "Create a key" with clear intent — mint it in one
	// click (auto-fire the create step on mount). Guarded against StrictMode's
	// double-invoke and re-renders.
	const autoRan = useRef(false);
	useEffect(() => {
		if (account && step === "create" && !autoRan.current) {
			autoRan.current = true;
			submitCreate();
		}
	}, [account, step, submitCreate]);

	const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			fn();
		}
	};

	return (
		<div className="sl-keygen">
			{step === "email" ? (
				<div>
					<span className="sl-keygen-label">Create your API key</span>
					<div className="sl-keygen-row">
						<input
							type="email"
							autoComplete="email"
							aria-label="Email address"
							className="dataset-sandbox-filter-input"
							placeholder="you@company.xyz"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={onEnter(submitEmail)}
						/>
						<button
							type="button"
							className="sl-keygen-btn"
							disabled={busy}
							onClick={submitEmail}
						>
							{busy ? "Sending…" : "Continue"}
						</button>
					</div>
					<div className="sl-keygen-foot">
						<button type="button" className="sl-keygen-link" onClick={onCancel}>
							{context === "sandbox" ? "← I already have a key" : "← Cancel"}
						</button>
					</div>
				</div>
			) : null}

			{step === "code" ? (
				<div>
					<span className="sl-keygen-label">
						Enter the 6-digit code
						<span className="hint" id={codeHintId}>
							{" "}
							· sent to {email}
						</span>
					</span>
					<div className="sl-keygen-row">
						<input
							inputMode="numeric"
							autoComplete="one-time-code"
							aria-label="Verification code"
							aria-describedby={codeHintId}
							maxLength={6}
							className="dataset-sandbox-filter-input sl-keygen-code"
							placeholder="••••••"
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							onKeyDown={onEnter(submitCode)}
						/>
						<button
							type="button"
							className="sl-keygen-btn"
							disabled={busy}
							onClick={submitCode}
						>
							{busy ? "Verifying…" : "Verify"}
						</button>
					</div>
					<div className="sl-keygen-foot">
						<button
							type="button"
							className="sl-keygen-link"
							onClick={() => {
								setStep("email");
								setCode("");
								setError(null);
							}}
						>
							← change email
						</button>
					</div>
				</div>
			) : null}

			{step === "create" ? (
				busy && !error ? (
					<div>
						<span className="sl-keygen-label" aria-live="polite">
							Creating your key…
							<span className="hint"> · signed in as {account?.email}</span>
						</span>
					</div>
				) : (
					<div>
						<span className="sl-keygen-label">
							Create a {productLabel} key
							<span className="hint"> · signed in as {account?.email}</span>
						</span>
						<div className="sl-keygen-row">
							<button
								type="button"
								className="sl-keygen-btn"
								disabled={busy}
								onClick={submitCreate}
							>
								{error ? "Try again" : "Create key"}
							</button>
							<button
								type="button"
								className="sl-keygen-link"
								onClick={onCancel}
							>
								{context === "sandbox"
									? "← I'll paste one instead"
									: "← Cancel"}
							</button>
						</div>
					</div>
				)
			) : null}

			{step === "reveal" ? (
				<div>
					<span className="sl-keygen-label">
						Your API key
						<span className="hint"> · copy it now — shown once</span>
					</span>
					<div className="sl-keygen-key">
						<code>{revealed}</code>
						<CopyButton code={revealed} />
					</div>
					<div className="sl-keygen-foot">
						<span className="sl-keygen-ok">
							{context === "sandbox"
								? "✓ Filled into the playground"
								: "✓ Store it now — it won't be shown again"}
						</span>
						<button type="button" className="sl-keygen-link" onClick={onCancel}>
							Done
						</button>
					</div>
				</div>
			) : null}

			{error ? (
				<p className="sl-keygen-err" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
