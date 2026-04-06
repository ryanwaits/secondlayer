"use client";

import { ChatInput } from "@/components/sessions/chat-input";
import { useSessionTabs } from "@/components/console/tab-bar";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUGGESTIONS = [
	"Check my streams",
	"Deploy a subgraph",
	"Show usage",
];

const GREETINGS = [
	(n: string) => `What are you building, ${n}?`,
	(n: string) => `How can I help, ${n}?`,
	(n: string) => `What's on your mind, ${n}?`,
	(n: string) => `Good to see you, ${n}`,
	(n: string) => `What are we working on, ${n}?`,
	(n: string) => `Ready when you are, ${n}`,
	(n: string) => `What do you need, ${n}?`,
	(n: string) => `Let's get to it, ${n}`,
];

function formatRelative(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

function pickGreeting(name: string): string {
	// Use date-based seed so it changes daily but not per render
	const day = Math.floor(Date.now() / 86_400_000);
	const idx = day % GREETINGS.length;
	return GREETINGS[idx](name);
}

interface RecentSession {
	id: string;
	title: string | null;
	created_at: string;
}

export default function SessionsPage() {
	const router = useRouter();
	const { account } = useAuth();
	const { removeTab } = useSessionTabs();
	const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

	const deleteSession = useCallback(
		async (id: string) => {
			setRecentSessions((prev) => prev.filter((s) => s.id !== id));
			removeTab(id);
			await fetch(`/api/sessions/${id}`, {
				method: "DELETE",
				credentials: "same-origin",
			});
		},
		[removeTab],
	);

	useEffect(() => {
		fetch("/api/sessions/list", { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : { sessions: [] }))
			.then((data) => setRecentSessions(data.sessions ?? []))
			.catch(() => {});
	}, []);

	const greeting = useMemo(() => {
		const name = account?.displayName || account?.email?.split("@")[0] || "there";
		return pickGreeting(name);
	}, [account]);

	const navigate = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			router.push(`/sessions/${id}?q=${encodeURIComponent(text)}`);
		},
		[router],
	);

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

				<h1 className="sessions-greeting">{greeting}</h1>

				<ChatInput onSend={navigate} placeholder="Message secondlayer..." />

				<div className="sessions-chips">
					{SUGGESTIONS.map((s) => (
						<button
							key={s}
							type="button"
							className="sessions-chip"
							onClick={() => navigate(s)}
						>
							{s}
						</button>
					))}
				</div>

				{recentSessions.length > 0 && (
					<div className="sessions-recent">
						<div className="sessions-recent-label">Recent</div>
						{recentSessions.map((s) => (
							<div key={s.id} className="sessions-recent-item">
								<Link
									href={`/sessions/${s.id}`}
									className="sessions-recent-link"
								>
									<span className="sessions-recent-title">
										{s.title || "Untitled"}
									</span>
									<span className="sessions-recent-date">
										{formatRelative(s.created_at)}
									</span>
								</Link>
								<button
									type="button"
									className="sessions-recent-delete"
									onClick={() => deleteSession(s.id)}
								>
									<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
										<path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
									</svg>
								</button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
