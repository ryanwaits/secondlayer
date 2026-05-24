"use client";

import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useState,
} from "react";

type Mode = "human" | "agent";

const DocsModeContext = createContext<{
	mode: Mode;
	setMode: (m: Mode) => void;
}>({ mode: "human", setMode: () => {} });

export function DocsModeProvider({ children }: { children: ReactNode }) {
	const [mode, setModeState] = useState<Mode>("human");

	// Restore the reader's last choice (defaults to human on first visit / SSR).
	useEffect(() => {
		const saved = localStorage.getItem("docs-mode");
		if (saved === "agent" || saved === "human") setModeState(saved);
	}, []);

	const setMode = (m: Mode) => {
		setModeState(m);
		try {
			localStorage.setItem("docs-mode", m);
		} catch {}
	};

	return (
		<DocsModeContext.Provider value={{ mode, setMode }}>
			{children}
		</DocsModeContext.Provider>
	);
}

export function useDocsMode() {
	return useContext(DocsModeContext);
}

function HumanIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
		</svg>
	);
}
function AgentIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="3" y="6" width="18" height="12" rx="2" />
			<path d="M9 11h.01M15 11h.01M8 18l-2 3" />
		</svg>
	);
}

/** Floating Human | Agent switch (every.to-style), painted in our tokens. */
export function ModeToggle() {
	const { mode, setMode } = useDocsMode();
	return (
		<div className="docs-mode-toggle" role="tablist" aria-label="Reading mode">
			<button
				type="button"
				role="tab"
				aria-selected={mode === "human"}
				className={mode === "human" ? "active" : ""}
				onClick={() => setMode("human")}
			>
				<HumanIcon /> Human
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={mode === "agent"}
				className={mode === "agent" ? "active" : ""}
				onClick={() => setMode("agent")}
			>
				<AgentIcon /> Agent
			</button>
		</div>
	);
}
