"use client";

import { VerifyUnreachableError, useAuth } from "@/lib/auth";
import { takeRememberedNext } from "@/lib/safe-next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

/** Messages that say nothing the visitor can act on; they get the friendly copy. */
const GENERIC_ERRORS = new Set(["", "internal error", "verification failed"]);
const LINK_FAILED =
	"That sign-in link didn't work. It may have expired or been used already.";

function VerifyContent() {
	const searchParams = useSearchParams();
	const { verify } = useAuth();
	// Read once: the address bar loses the token below, and with it this value.
	const [token] = useState(() => searchParams.get("token"));
	const [error, setError] = useState<string | null>(null);
	const [retryable, setRetryable] = useState(false);
	const attempted = useRef(false);

	const doVerify = useCallback(async () => {
		if (!token || attempted.current) return;
		attempted.current = true;
		// The one-time token must not outlive this line in the address bar:
		// analytics and replay read the URL. Done before anything is awaited.
		window.history.replaceState(window.history.state, "", "/auth/verify");

		try {
			await verify(token);
			window.location.href = takeRememberedNext();
		} catch (err) {
			const message = err instanceof Error ? err.message.trim() : "";
			setError(GENERIC_ERRORS.has(message.toLowerCase()) ? "" : message);
			// A verify that got no answer left the link unused: it can try again.
			setRetryable(err instanceof VerifyUnreachableError);
		}
	}, [token, verify]);

	useEffect(() => {
		doVerify();
	}, [doVerify]);

	if (!token) {
		return (
			<div
				className="homepage"
				style={{ textAlign: "center", paddingTop: 120 }}
			>
				<p style={{ color: "var(--text-muted)" }}>
					Missing verification token.
				</p>
			</div>
		);
	}

	if (error !== null) {
		return (
			<div
				className="homepage"
				style={{ textAlign: "center", paddingTop: 120 }}
			>
				<p style={{ color: "var(--alarm)" }}>{error || LINK_FAILED}</p>
				<p style={{ marginTop: 20 }}>
					{retryable ? (
						<button
							type="button"
							className="acct-btn solid"
							style={{ display: "inline-flex" }}
							onClick={() => {
								attempted.current = false;
								setError(null);
								setRetryable(false);
								void doVerify();
							}}
						>
							Try again
						</button>
					) : (
						<Link
							href="/signin"
							className="acct-btn solid"
							style={{ display: "inline-flex" }}
						>
							Send a new link
						</Link>
					)}
				</p>
			</div>
		);
	}

	return (
		<div className="homepage" style={{ textAlign: "center", paddingTop: 120 }}>
			<p style={{ color: "var(--text-muted)" }}>Verifying...</p>
		</div>
	);
}

export default function VerifyPage() {
	return (
		<Suspense
			fallback={
				<div
					className="homepage"
					style={{ textAlign: "center", paddingTop: 120 }}
				>
					<p style={{ color: "var(--text-muted)" }}>Loading...</p>
				</div>
			}
		>
			<VerifyContent />
		</Suspense>
	);
}
