"use client";

import {
	type ReactNode,
	createContext,
	useCallback,
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

	const setMode = useCallback((m: Mode) => {
		setModeState(m);
		try {
			localStorage.setItem("docs-mode", m);
		} catch {}
	}, []);

	// Keyboard shortcuts: ⌘/Ctrl+← → human, ⌘/Ctrl+→ → agent (positional,
	// matching the toggle order), and bare H / A as direct jumps. Ignored
	// while typing in a field so search/command-palette input is unaffected.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (
				t?.isContentEditable ||
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT"
			)
				return;

			if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					setMode("human");
				} else if (e.key === "ArrowRight") {
					e.preventDefault();
					setMode("agent");
				}
				return;
			}

			// Bare letters only — never with a modifier, so ⌘A/⌘H stay native.
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k === "h") setMode("human");
			else if (k === "a") setMode("agent");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [setMode]);

	return (
		<DocsModeContext.Provider value={{ mode, setMode }}>
			{children}
		</DocsModeContext.Provider>
	);
}

export function useDocsMode() {
	return useContext(DocsModeContext);
}

/** Floating Human | Agent switch (every.to-style), painted in our tokens.
 *  Each tab leads with its [H] / [A] keycap (same style as the nav links) to
 *  signal the keyboard shortcut. */
export function ModeToggle() {
	const { mode, setMode } = useDocsMode();
	return (
		<div className="docs-mode-toggle" role="tablist" aria-label="Reading mode">
			<button
				type="button"
				role="tab"
				aria-selected={mode === "human"}
				aria-keyshortcuts="H"
				title="Human view (H or ⌘←)"
				className={mode === "human" ? "active" : ""}
				onClick={() => setMode("human")}
			>
				<span className="docs-mode-key" aria-hidden="true">
					[H]
				</span>
				<span className="docs-mode-label">Human</span>
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={mode === "agent"}
				aria-keyshortcuts="A"
				title="Agent view (A or ⌘→)"
				className={mode === "agent" ? "active" : ""}
				onClick={() => setMode("agent")}
			>
				<span className="docs-mode-key" aria-hidden="true">
					[A]
				</span>
				<span className="docs-mode-label">Agent</span>
			</button>
		</div>
	);
}
