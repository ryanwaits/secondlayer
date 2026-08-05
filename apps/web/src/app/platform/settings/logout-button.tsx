"use client";

import { useAuth } from "@/lib/auth";

export function LogoutButton() {
	const { logout } = useAuth();

	async function handleLogout() {
		await logout();
	}

	return (
		<button
			type="button"
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
