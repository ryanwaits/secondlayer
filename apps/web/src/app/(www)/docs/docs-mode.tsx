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

const DocsDrawerContext = createContext<{
	open: boolean;
	setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

/** Phone nav drawer: the top bar's burger opens it, the sidebar renders it. */
export function useDocsDrawer() {
	return useContext(DocsDrawerContext);
}

export function DocsModeProvider({ children }: { children: ReactNode }) {
	const [mode, setModeState] = useState<Mode>("human");
	const [drawerOpen, setDrawerOpen] = useState(false);

	// `?mode=agent` wins over the saved choice — llms.txt hands that URL to
	// agents, and it was inert (localStorage-only) until now, so the file was
	// advertising a parameter that did nothing.
	useEffect(() => {
		const fromUrl = new URLSearchParams(window.location.search).get("mode");
		if (fromUrl === "agent" || fromUrl === "human") {
			setModeState(fromUrl);
			return;
		}
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
			<DocsDrawerContext.Provider
				value={{ open: drawerOpen, setOpen: setDrawerOpen }}
			>
				{children}
			</DocsDrawerContext.Provider>
		</DocsModeContext.Provider>
	);
}

export function useDocsMode() {
	return useContext(DocsModeContext);
}

/** Human | Agent switch for the docs top bar. The shortcut hints (H / A,
 *  ⌘←/→) live in the title and aria-keyshortcuts so the control stays quiet. */
export function ModeToggle() {
	const { mode, setMode } = useDocsMode();
	return (
		<div className="docs-seg" role="tablist" aria-label="Docs view">
			<button
				type="button"
				role="tab"
				aria-selected={mode === "human"}
				aria-keyshortcuts="H"
				title="Human view (H or ⌘←)"
				onClick={() => setMode("human")}
			>
				Human
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={mode === "agent"}
				aria-keyshortcuts="A"
				title="Agent view (A or ⌘→)"
				onClick={() => setMode("agent")}
			>
				Agent
			</button>
		</div>
	);
}
