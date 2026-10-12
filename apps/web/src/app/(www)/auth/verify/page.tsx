"use client";

import { useAuth } from "@/lib/auth";
import { handOverNewKey } from "@/lib/new-key";
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
	const token = searchParams.get("token");
	const [error, setError] = useState<string | null>(null);
	const attempted = useRef(false);

	const doVerify = useCallback(async () => {
		if (!token || attempted.current) return;
		attempted.current = true;

		try {
			const { apiKey } = await verify(token);
			handOverNewKey(apiKey);
			window.location.href = "/account/keys";
		} catch (err) {
			const message = err instanceof Error ? err.message.trim() : "";
			setError(GENERIC_ERRORS.has(message.toLowerCase()) ? "" : message);
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
					<Link
						href="/login"
						className="acct-btn solid"
						style={{ display: "inline-flex" }}
					>
						Send a new link
					</Link>
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
