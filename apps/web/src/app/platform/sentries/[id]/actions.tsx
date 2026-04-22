"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const BROWSER_API_URL =
	process.env.NEXT_PUBLIC_SL_API_URL || "http://localhost:3800";

interface Props {
	sentryId: string;
	active: boolean;
}

export default function SentryActions({ sentryId, active }: Props) {
	const router = useRouter();
	const [testing, setTesting] = useState(false);
	const [toggling, setToggling] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const sendTest = async () => {
		setTesting(true);
		setMessage(null);
		try {
			const res = await fetch(
				`${BROWSER_API_URL}/api/sentries/${sentryId}/test`,
				{ method: "POST", credentials: "include" },
			);
			const body = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				error?: string;
			};
			if (res.ok && body.ok) {
				setMessage("Test alert delivered");
			} else {
				setMessage(body.error ?? `Delivery failed (${res.status})`);
			}
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Failed");
		} finally {
			setTesting(false);
			setTimeout(() => setMessage(null), 4000);
		}
	};

	const toggle = async () => {
		setToggling(true);
		try {
			await fetch(`${BROWSER_API_URL}/api/sentries/${sentryId}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ active: !active }),
			});
			router.refresh();
		} finally {
			setToggling(false);
		}
	};

	const remove = async () => {
		if (
			!confirm(
				"Delete this sentry? Alert history will be removed and cannot be recovered.",
			)
		)
			return;
		setDeleting(true);
		try {
			const res = await fetch(`${BROWSER_API_URL}/api/sentries/${sentryId}`, {
				method: "DELETE",
				credentials: "include",
			});
			if (res.ok) {
				router.push("/sentries");
			} else {
				setMessage("Delete failed");
				setDeleting(false);
			}
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Failed");
			setDeleting(false);
		}
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 8,
			}}
		>
			<div style={{ display: "flex", gap: 8 }}>
				<button
					type="button"
					className="settings-btn ghost"
					onClick={sendTest}
					disabled={testing}
				>
					{testing ? "Sending…" : "Send test alert"}
				</button>
				<button
					type="button"
					className="settings-btn ghost"
					onClick={toggle}
					disabled={toggling}
				>
					{toggling ? "…" : active ? "Pause" : "Resume"}
				</button>
				<button
					type="button"
					className="settings-btn danger"
					onClick={remove}
					disabled={deleting}
				>
					{deleting ? "…" : "Delete"}
				</button>
			</div>
			{message && (
				<div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{message}</div>
			)}
		</div>
	);
}
