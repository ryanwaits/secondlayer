"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const RECENT_SESSIONS = [
	"Show me the latest stacking cycle data and current APY",
	"Which tokens had the most transfer volume this week?",
	"Pause all streams that have failed webhook deliveries",
	"Compare stacking rewards between cycle 90 and 91",
	"How many unique wallets interacted with the BNS contract today?",
];

export default function SessionsPage() {
	const router = useRouter();
	const [query, setQuery] = useState("");

	function handleSubmit() {
		if (!query.trim()) return;
		const id = Math.random().toString(36).slice(2, 10);
		router.push(`/sessions/${id}?q=${encodeURIComponent(query.trim())}`);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", flex: 1 }}>
			<div className="sessions-hero">
				{/* Logo */}
				<div className="sessions-brand-mark">
					<svg viewBox="4 7 40 28" width="44" height="30" fill="none">
						<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
						<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
					</svg>
				</div>

				<h1 className="sessions-greeting">New Session</h1>

				{/* Chat input */}
				<div className="sessions-input-wrap">
					<input
						className="sessions-input"
						type="text"
						placeholder="Search or ask a question..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleSubmit();
						}}
					/>
					<button
						type="button"
						className="sessions-submit"
						onClick={handleSubmit}
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 8h10M10 5l3 3-3 3" />
						</svg>
					</button>
				</div>
				<p className="sessions-disclaimer">
					Navigate to anything, or ask in plain English
				</p>

				{/* Recent sessions */}
				<div className="sessions-recent">
					<div className="sessions-links-header">Recent Sessions</div>
					<ul className="sessions-links-list">
						{RECENT_SESSIONS.map((s) => (
							<li key={s}>
								<a
									className="sessions-link-item"
									onClick={() => {
										setQuery(s);
										const id = Math.random().toString(36).slice(2, 10);
										router.push(`/sessions/${id}?q=${encodeURIComponent(s)}`);
									}}
								>
									<em>&ldquo;{s}&rdquo;</em>
								</a>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}
