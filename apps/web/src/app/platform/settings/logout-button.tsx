"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
	const router = useRouter();

	async function handleLogout() {
		await fetch("/api/auth/logout", { method: "POST" });
		router.push("/");
		router.refresh();
	}

	return (
		<button
			onClick={handleLogout}
			className="dash-empty-action"
			style={{
				background: "var(--text-main)",
				border: "1px solid var(--text-main)",
				borderRadius: 6,
				padding: "6px 14px",
				fontSize: 13,
				color: "var(--bg)",
				cursor: "pointer",
			}}
		>
			Log out
		</button>
	);
}
