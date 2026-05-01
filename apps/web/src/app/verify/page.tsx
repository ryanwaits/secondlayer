"use client";

import { useAuth } from "@/lib/auth";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

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
			const result = await verify(token);

			// Dispatch event for floating toolbar to show API key
			if (result.apiKey) {
				window.dispatchEvent(
					new CustomEvent("sl:verified", { detail: { apiKey: result.apiKey } }),
				);
				// Brief delay so toolbar can show the key
				setTimeout(() => {
					window.location.href = "/";
				}, 100);
			} else {
				window.location.href = "/";
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Verification failed");
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

	if (error) {
		return (
			<div
				className="homepage"
				style={{ textAlign: "center", paddingTop: 120 }}
			>
				<p style={{ color: "#ef4444" }}>{error}</p>
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
