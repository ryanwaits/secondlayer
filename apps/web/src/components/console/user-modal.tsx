"use client";

import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";

interface UserModalProps {
	open: boolean;
	onClose: () => void;
}

export function UserModal({ open, onClose }: UserModalProps) {
	const { account, logout } = useAuth();
	const email = account?.email ?? "";
	const initial = email ? email[0].toUpperCase() : "U";
	const name = email ? email.split("@")[0] : "User";

	const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

	useEffect(() => {
		const saved = localStorage.getItem("sl-theme");
		if (saved) setTheme(saved as "system" | "light" | "dark");
	}, []);

	useEffect(() => {
		const html = document.documentElement;
		html.classList.remove("force-light", "force-dark");
		if (theme === "light") {
			html.style.colorScheme = "light";
			html.classList.add("force-light");
		} else if (theme === "dark") {
			html.style.colorScheme = "dark";
			html.classList.add("force-dark");
		} else {
			html.style.colorScheme = "";
		}
		localStorage.setItem("sl-theme", theme);
	}, [theme]);

	if (!open) return null;

	return (
		<div
			className="user-modal-overlay"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="user-modal">
				<button type="button" className="user-modal-close" onClick={onClose}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					>
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>

				<h2 className="user-modal-title">User settings</h2>

				<div className="user-modal-profile">
					<div className="user-modal-avatar">{initial}</div>
					<div className="user-modal-info">
						<div className="user-modal-name">{name}</div>
						<div className="user-modal-email">{email}</div>
					</div>
					<button
						type="button"
						className="user-modal-signout"
						onClick={() => {
							logout();
							onClose();
						}}
					>
						Sign out
					</button>
				</div>

				<div className="user-modal-theme">
					<span className="user-modal-theme-label">Theme</span>
					<div className="theme-switcher">
						<button
							type="button"
							className={`theme-opt${theme === "light" ? " active" : ""}`}
							title="Light"
							onClick={() => setTheme("light")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<circle cx="8" cy="8" r="3" />
								<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" />
							</svg>
						</button>
						<button
							type="button"
							className={`theme-opt${theme === "dark" ? " active" : ""}`}
							title="Dark"
							onClick={() => setTheme("dark")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4.5 4.5 0 0 0 6 6z" />
							</svg>
						</button>
						<button
							type="button"
							className={`theme-opt${theme === "system" ? " active" : ""}`}
							title="System"
							onClick={() => setTheme("system")}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="2" y="3" width="12" height="8" rx="1" />
								<path d="M5 14h6" />
								<path d="M8 11v3" />
							</svg>
						</button>
					</div>
				</div>

				<div className="user-modal-footer">
					<button
						type="button"
						className="user-modal-close-btn"
						onClick={onClose}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
