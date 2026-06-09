"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface VisibilityToggleProps {
	subgraphName: string;
	visibility: "public" | "private";
	sessionToken: string;
}

/**
 * Public/private badge + toggle. Public = anon reads at /v1/subgraphs/<name>
 * (global name claim); private = owning account's key only. Mirrors
 * `sl subgraphs publish|unpublish`.
 */
export function VisibilityToggle({
	subgraphName,
	visibility,
	sessionToken,
}: VisibilityToggleProps) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const isPublic = visibility === "public";

	async function toggle() {
		if (
			isPublic &&
			!window.confirm(
				`Make "${subgraphName}" private? Public reads stop and the global name claim is released.`,
			)
		) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			const res = await fetch(
				`/api/subgraphs/${subgraphName}/${isPublic ? "unpublish" : "publish"}`,
				{
					method: "POST",
					headers: { Authorization: `Bearer ${sessionToken}` },
				},
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
					code?: string;
				} | null;
				throw new Error(
					body?.code === "PUBLIC_NAME_TAKEN"
						? `The public name "${subgraphName}" is taken by another account.`
						: (body?.error ?? `Request failed (${res.status})`),
				);
			}
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			setBusy(false);
		}
	}

	return (
		<span
			style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
			title={
				isPublic
					? "Anyone can read this subgraph at /v1 without a key"
					: "Reads require your API key"
			}
		>
			<span className="sg-hdr-version">{isPublic ? "public" : "private"}</span>
			<button
				type="button"
				className="sg-hdr-btn"
				disabled={busy}
				onClick={toggle}
			>
				{busy ? "…" : isPublic ? "Unpublish" : "Publish"}
			</button>
			{error && (
				<span style={{ fontSize: 12, color: "var(--text-muted)" }}>
					{error}
				</span>
			)}
		</span>
	);
}
